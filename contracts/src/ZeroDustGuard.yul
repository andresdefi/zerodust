/// @title ZeroDustGuard: exact-zero direct sweeps on rollups with an L1 data fee (OP stack)
/// @notice Where a wallet cannot delegate (no EIP-7702) it sweeps itself, and on OP-stack chains every
/// transaction also pays an L1 data fee that moves with L1 prices: a plain transfer sized for one fee
/// leaves dust when the fee falls, so it cannot promise exactly 0. Through this guard it can.
///
/// The wallet sends ONE legacy transaction: guard.sweep{value: v}(target, fee, data) with gas limit G,
/// v = balance - G x gasPrice - L1 fee, the L1 fee computed exactly from the signed bytes. The chain
/// charges G x gasPrice and the L1 fee before any code runs, so while the guard runs the wallet holds
/// exactly 0 if (and only if) the planned fee was the charged one. The guard then:
///   1. requires the caller's balance to be exactly 0 (else reverts: the attempt costs its gas, a
///      retry plans again; a fee that ROSE makes the transaction invalid before it runs, at no cost),
///   2. pays `fee` to ZeroDust and forwards the rest to `target` with `data` (a recipient, or a
///      bridge deposit that names its own recipient and refund address),
///   3. requires the caller's balance to still be 0 (nothing refunded to the wallet in the call),
///   4. burns every unit of gas left, so the chain refunds no unused gas: the wallet stays at 0.
/// Every attempt therefore ends at exactly 0 or changes nothing but the attempt's own fee.
///
/// No storage, no owner, no upgrade. The ZeroDust fee address is a constant.
///
/// sweep(address target, uint256 fee, bytes data): selector 0x1a8b33c4.
/// Errors: NotAtZero() 0x65a44a69, FeeAboveValue() 0x779fecd8, FeeTransferFailed() 0x4033e4e3,
/// CallFailed() 0x3204506f, RefundedToWallet() 0xcfe01bfb, GasTooLow() 0x858c8974,
/// BadCalldata() 0x1a2e1594.
object "ZeroDustGuard" {
    code {
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    object "runtime" {
        code {
            function fail(selector) {
                mstore(0, shl(224, selector))
                revert(0, 4)
            }

            if iszero(eq(shr(224, calldataload(0)), 0x1a8b33c4)) { fail(0x1a2e1594) }
            let target := calldataload(4)
            if shr(160, target) { fail(0x1a2e1594) }
            let fee := calldataload(36)
            let dataStart := add(4, calldataload(68))
            let dataLen := calldataload(dataStart)
            dataStart := add(dataStart, 32)
            if gt(add(dataStart, dataLen), calldatasize()) { fail(0x1a2e1594) }

            // 1. Gas, the L1 fee and the value are already taken: the wallet must be at exactly 0
            if balance(caller()) { fail(0x65a44a69) }
            if gt(fee, callvalue()) { fail(0x779fecd8) }

            // 2. ZeroDust's fee, then everything else to the target
            if fee {
                if iszero(call(gas(), 0x01eD5c94DE39E73C986b98B85C2c0A3d1BEDff7D, fee, 0, 0, 0, 0)) { fail(0x4033e4e3) }
            }
            calldatacopy(0, dataStart, dataLen)
            if iszero(call(gas(), target, sub(callvalue(), fee), 0, dataLen, 0, 0)) { fail(0x3204506f) }

            // 3. Nothing came back to the wallet during the call
            if balance(caller()) { fail(0xcfe01bfb) }

            // 4. Burn every unit of gas left; the tail below needs more than 80 on entry
            if lt(gas(), 200) { fail(0x858c8974) }
            // Hand-counted tail (offsets relative to its first byte):
            //  0 JUMPDEST(1) 1 GAS(2) 2 PUSH2 0x0050(3) 5 LT(3) 6 PC(2) 7 PUSH1 6(3) 9 SWAP1(3)
            //  10 SUB(3) 11 JUMPI(10): loop back to 0 while 80 < g; 30 gas per lap, so the loop
            //  exits with g in [51, 80] (g = gas left after the GAS at 1) and 27 more spent.
            //  12 GAS(2): h = g - 29, in [22, 51]. 13 PC(2) 14 PUSH1 65(3) 16 ADD(3) 17 SUB(3)
            //  18 JUMP(8): to offset 78 - h, inside the sled 19..58 (40 x JUMPDEST, 1 gas each),
            //  leaving h - 19 gas, exactly what the (h - 19) JUMPDESTs up to the STOP at 59 cost.
            verbatim_0i_0o(hex"5b5a610050105860069003575a5860410103565b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b00")
        }
    }
}
