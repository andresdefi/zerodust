// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPaymaster, ExecutionResult, PAYMASTER_VALIDATION_SUCCESS_MAGIC} from
    "@matterlabs/zksync-contracts/contracts/system-contracts/interfaces/IPaymaster.sol";
import {IPaymasterFlow} from "@matterlabs/zksync-contracts/contracts/system-contracts/interfaces/IPaymasterFlow.sol";
import {Transaction} from "@matterlabs/zksync-contracts/contracts/system-contracts/libraries/TransactionHelper.sol";
import {BOOTLOADER_FORMAL_ADDRESS} from "@matterlabs/zksync-contracts/contracts/system-contracts/Constants.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title ZeroDustPaymaster
 * @notice Pays the gas of ZeroDust sweeps on ZK-stack chains (zkSync Era, Abstract, Lens, Sophon),
 * so a wallet can send its whole balance and end at exactly 0.
 *
 * Why exactly 0: with a paymaster, the bootloader charges the paymaster for gas and refunds unused
 * gas to the paymaster; the account only needs `value` (TransactionHelper.totalRequiredBalance).
 * A sweep is two transactions whose values add up to the balance:
 *   1. fee:   to this contract, value = ZeroDust's service fee + the gas of both transactions;
 *   2. sweep: to the bridge deposit or recipient, value = the rest.
 *
 * Both need an approval signed by `approver` (ZeroDust's backend) over the exact transaction:
 * sender, nonce, target, value, calldata hash, and the most gas the paymaster may pay for it
 * (gasLimit x maxFeePerGas must not exceed it). The nonce makes
 * every approval single-use. The sweep is also paid only out of credit left by that wallet's fee
 * transaction, so the paymaster never pays for a sweep whose fee was not paid, and never for a
 * transaction it did not approve.
 *
 * Validation reads no block context (no timestamp): approvals are bound to the nonce instead.
 */
contract ZeroDustPaymaster is IPaymaster, EIP712 {
    bytes32 public constant APPROVAL_TYPEHASH = keccak256(
        "Approval(address from,uint256 nonce,address to,uint256 value,bytes32 dataHash,uint256 maxGasCost)"
    );

    uint8 private constant KIND_FEE = 1;
    uint8 private constant KIND_SWEEP = 2;

    address public owner;
    address public approver;

    /// @notice Gas budget a wallet's fee transaction prepaid for its sweep, in wei
    mapping(address => uint256) public credit;

    event ApproverChanged(address indexed approver);
    event OwnerChanged(address indexed owner);
    event Withdrawn(address indexed to, uint256 amount);

    error NotBootloader();
    error NotOwner();
    error UnsupportedFlow();
    error BadApproval();
    error FeeBelowGas();
    error FeeWithData();
    error NoCredit();
    error BootloaderPaymentFailed();
    error ZeroAddress();
    error GasAboveApproval();

    modifier onlyBootloader() {
        if (msg.sender != BOOTLOADER_FORMAL_ADDRESS) revert NotBootloader();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, address _approver) EIP712("ZeroDust Paymaster", "1") {
        if (_owner == address(0) || _approver == address(0)) revert ZeroAddress();
        owner = _owner;
        approver = _approver;
        emit OwnerChanged(_owner);
        emit ApproverChanged(_approver);
    }

    /// @notice The EIP-712 digest the approver signs for a transaction
    function approvalDigest(
        address from,
        uint256 nonce,
        address to,
        uint256 value,
        bytes32 dataHash,
        uint256 maxGasCost
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(APPROVAL_TYPEHASH, from, nonce, to, value, dataHash, maxGasCost)));
    }

    function validateAndPayForPaymasterTransaction(bytes32, bytes32, Transaction calldata _transaction)
        external
        payable
        onlyBootloader
        returns (bytes4 magic, bytes memory context)
    {
        bytes calldata input = _transaction.paymasterInput;
        if (input.length < 4 || bytes4(input[0:4]) != IPaymasterFlow.general.selector) revert UnsupportedFlow();
        // general(bytes inner), inner = abi.encode(maxGasCost, signature)
        bytes memory inner = abi.decode(input[4:], (bytes));
        (uint256 maxGasCost, bytes memory signature) = abi.decode(inner, (uint256, bytes));

        address from = address(uint160(_transaction.from));
        address to = address(uint160(_transaction.to));
        uint256 requiredETH = _transaction.gasLimit * _transaction.maxFeePerGas;
        if (requiredETH > maxGasCost) revert GasAboveApproval();

        bytes32 digest = approvalDigest(
            from,
            _transaction.nonce,
            to,
            _transaction.value,
            keccak256(_transaction.data),
            maxGasCost
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != approver) revert BadApproval();

        if (to == address(this)) {
            // Fee: pays for itself; the rest becomes the sweep's gas credit after it executes
            if (_transaction.data.length != 0) revert FeeWithData();
            if (_transaction.value < requiredETH) revert FeeBelowGas();
            context = abi.encode(KIND_FEE, from, _transaction.value - requiredETH);
        } else {
            uint256 available = credit[from];
            if (available < requiredETH) revert NoCredit();
            credit[from] = available - requiredETH;
            context = abi.encode(KIND_SWEEP, from, uint256(0));
        }

        (bool ok,) = BOOTLOADER_FORMAL_ADDRESS.call{value: requiredETH}("");
        if (!ok) revert BootloaderPaymentFailed();
        magic = PAYMASTER_VALIDATION_SUCCESS_MAGIC;
    }

    function postTransaction(
        bytes calldata _context,
        Transaction calldata,
        bytes32,
        bytes32,
        ExecutionResult _txResult,
        uint256
    ) external payable onlyBootloader {
        (uint8 kind, address from, uint256 amount) = abi.decode(_context, (uint8, address, uint256));
        // A fee transaction that reverted moved no value: it earns no credit
        if (kind == KIND_FEE && _txResult == ExecutionResult.Success) credit[from] += amount;
    }

    // ============ Owner ============

    function setApprover(address _approver) external onlyOwner {
        if (_approver == address(0)) revert ZeroAddress();
        approver = _approver;
        emit ApproverChanged(_approver);
    }

    function setOwner(address _owner) external onlyOwner {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
        emit OwnerChanged(_owner);
    }

    /// @notice Moves float above the minimum to the treasury (the backend keeps the minimum)
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(to, amount);
    }

    /// @notice Fee transactions and float top-ups land here
    receive() external payable {}
}
