import { ScMath, Liquidation, MaxLiquidableReason } from './liquidation';

type LiquidationParams = {
    collateral_factor_pct: bigint;
    deposit_native_usd: bigint;
    debt_native_usd: bigint;
    liquidation_bonus_pct: bigint;
};

describe(`sdk: liquidation`, () => {
    it(`should give correct rv_repaid_asset`, async () => {
        //                                           TON	USDT
        // Collateral factor (liquidation threshold)	80%	85%
        // Deposited amount in USD	                  5.4 USD	0.1 USD
        // Borrowed amount in USD	                    2.5 USD	2.6 USD
        // Liquidation bonus	                        6%	7%
        const liquidationParams: {
            TON: LiquidationParams;
            USDT: LiquidationParams;
        } = {
            TON: {
                collateral_factor_pct: 80n,
                deposit_native_usd: 540_000_000n,
                debt_native_usd: 250_000_000n,
                liquidation_bonus_pct: 6n,
            },
            USDT: {
                collateral_factor_pct: 85n,
                deposit_native_usd: 10_000_000n,
                debt_native_usd: 260_000_000n,
                liquidation_bonus_pct: 7n,
            },
        };
        const native_usd_sum_of_collaterals_with_collateral_factors =
            ScMath.bigint_mul(
                liquidationParams.TON.deposit_native_usd,
                ScMath.uint_scale_pct(liquidationParams.TON.collateral_factor_pct),
            ) +
            ScMath.bigint_mul(
                liquidationParams.USDT.deposit_native_usd,
                ScMath.uint_scale_pct(liquidationParams.USDT.collateral_factor_pct),
            );

        const rv_usdt = Liquidation.calc_repaid_value({
            target_hf_pct: 99n, // recover back to HF = 99%
            native_usd_sum_of_debts_without_borrow_factors:
                liquidationParams.TON.debt_native_usd + liquidationParams.USDT.debt_native_usd,
            native_usd_sum_of_collaterals_with_collateral_factors,
            liquidated_reserve: {
                native_collateral_factor_pct: liquidationParams.TON.collateral_factor_pct,
                native_liquidation_bonus_factor_pct: liquidationParams.TON.liquidation_bonus_pct,
            },
        });

        // 4.57236842 USD
        expect(453521126n).toEqual(rv_usdt);
    });

    const TARGET_HF = 99n; // recover back to HF = 0.99

    it.each([
        //                                            TON	USDT
        // Collateral factor (liquidation threshold)	80%	85%
        // Deposited amount in USD	                  5.4 USD	0.1 USD
        // Borrowed amount in USD	                    0.1 USD	5 USD
        // Liquidation bonus	                        6%	7%
        {
            params: {
                TON: {
                    collateral_factor_pct: 80n,
                    // 5.4
                    deposit_native_usd: 540_000_000n,
                    // 0.1
                    debt_native_usd: 10_000_000n,
                    liquidation_bonus_pct: 6n,
                },
                USDT: {
                    collateral_factor_pct: 85n,
                    // 0.1
                    deposit_native_usd: 10_000_000n,
                    // 5
                    debt_native_usd: 500_000_000n,
                    liquidation_bonus_pct: 7n,
                },
            },
            /**
             * (−(0.99)(5+0.1)+(0.8×5.4+0.85×0.1))/((0.8)(1 + 0.06) - 0.99) = 4.53521126 USD
             */
            rv: 453521126n,
            /**
             * min(4.53521126, 5, 5.4 / 1.06)
             */
            maxLiquidable: {
                reason: MaxLiquidableReason.RepaidValue,
                value: 453521126n,
            },
        },
        //                                            TON	USDT
        // Collateral factor (liquidation threshold)	80%	85%
        // Deposited amount in USD	                  3 USD	2.5 USD
        // Borrowed amount in USD	                    0.1 USD	5 USD
        // Liquidation bonus                        	6%	7%
        {
            params: {
                TON: {
                    collateral_factor_pct: 80n,
                    // 3
                    deposit_native_usd: 300_000_000n,
                    // 0.1
                    debt_native_usd: 10_000_000n,
                    liquidation_bonus_pct: 6n,
                },
                USDT: {
                    collateral_factor_pct: 85n,
                    // 2.5
                    deposit_native_usd: 250_000_000n,
                    // 5
                    debt_native_usd: 500_000_000n,
                    liquidation_bonus_pct: 7n,
                },
            },
            /**
             * ((−(0.99)(5+0.1))+(0.8×3+0.85×2.5))/(0.8(1 + 0.06) - 0.99) = 3.69014084 USD
             */
            rv: 369014084n,
            maxLiquidable: {
                reason: MaxLiquidableReason.CollateralValue,
                /**
                 * min(3.69014084, 5, 3 / 1.06)
                 *
                 * CV_liquidated_asset / (1 + LF_liquidated_asset) =
                 * 3 / (1 + 0.06) = 2.830188679245283
                 */
                value: 2_83018867n,
            },
        },
        //                                            TON	USDT
        // Collateral factor (liquidation threshold)	80%	85%
        // Deposited amount in USD	                  5.4 USD	0.1 USD
        // Borrowed amount in USD	                    2.5 USD	2.6 USD
        // Liquidation bonus	                        6%	7%
        {
            params: {
                TON: {
                    collateral_factor_pct: 80n,
                    // 5.4
                    deposit_native_usd: 540_000_000n,
                    // 2.5
                    debt_native_usd: 250_000_000n,
                    liquidation_bonus_pct: 6n,
                },
                USDT: {
                    collateral_factor_pct: 85n,
                    // 0.1
                    deposit_native_usd: 10_000_000n,
                    // 2.6
                    debt_native_usd: 260_000_000n,
                    liquidation_bonus_pct: 7n,
                },
            },
            /**
             * ((−(0.99)(2.5+2.6))+(0.8×5.4+0.85×0.1))/(0.8(1 + 0.06) - 0.99) = 4.53521126 USD
             * 4.53521126 USD
             */
            rv: 453521126n,
            /**
             * min(4.53521126, 2.6, 5.4 / 1.06)
             */
            maxLiquidable: {
                reason: MaxLiquidableReason.DebtValue,
                value: 260_000_000n,
            },
        },
    ])(`should give correct max liquidable value: $maxLiquidable`, ({ params, rv, maxLiquidable }) => {
        const native_usd_sum_of_collaterals_with_collateral_factors =
            ScMath.bigint_mul(params.TON.deposit_native_usd, ScMath.uint_scale_pct(params.TON.collateral_factor_pct)) +
            ScMath.bigint_mul(params.USDT.deposit_native_usd, ScMath.uint_scale_pct(params.USDT.collateral_factor_pct));

        const rv_usdt = Liquidation.calc_repaid_value({
            target_hf_pct: TARGET_HF,
            native_usd_sum_of_debts_without_borrow_factors: params.TON.debt_native_usd + params.USDT.debt_native_usd,
            native_usd_sum_of_collaterals_with_collateral_factors,
            liquidated_reserve: {
                native_collateral_factor_pct: params.TON.collateral_factor_pct,
                native_liquidation_bonus_factor_pct: params.TON.liquidation_bonus_pct,
            },
        });

        expect(rv_usdt).toBe(rv);

        const max_liquidable = Liquidation.calc_max_liquidable_value({
            repaid_reserve: {
                repaid_value_native_usd: rv_usdt,
                debt_value_native_usd: params.USDT.debt_native_usd,
            },
            liquidated_reserve: {
                collateral_value_native_usd: params.TON.deposit_native_usd,
                liquidation_bonus_factor_pct: params.TON.liquidation_bonus_pct,
            },
        });

        expect(max_liquidable).toEqual(maxLiquidable);
    });
});
