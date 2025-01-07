function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

export class ScMath {
    public static SCALE = 1000000000000000000000000000n;

    // This function assumes `b` is scaled by `SCALE`
    static bigint_mul(a: bigint, b: bigint): bigint {
        assert(a >= 0, 'a must be gte 0');
        assert(b >= 0, 'b must be gte 0');

        const scaled_product = a * b;

        const result = scaled_product / this.SCALE;

        return result;
    }

    // This function assumes `b` is scaled by `SCALE`
    static bigint_div(a: bigint, b: bigint): bigint {
      assert(a >= 0, 'a must be gte 0');
      assert(b >= 0, 'b must be gte 0');

      const scaled_product = a * this.SCALE;

      const result = scaled_product / b;

      return result;
  }

  static uint_scale_pct(pct: bigint) {
      assert(pct >= 0, 'pct must be gte 0');
      assert(pct <= 100, 'pct must be less than or equal to 100');

      return (pct * this.SCALE) / 100n;
  }

  static bigint_min(...args: bigint[]): bigint {
    return args.reduce((min, current) => (current < min ? current : min), args[0]);
  }
}

export type CalcRepaidValueParams = {
    /**
     * 0 <= target_hf_pct < 100
     * (usually very close to 1)
     */
    target_hf_pct: bigint;
    /**
     * will be in whatever the number of decimal places USD is in
     */
    native_usd_sum_of_debts_without_borrow_factors: bigint;
    /**
     * will be in whatever the number of decimal places USD is in
     */
    native_usd_sum_of_collaterals_with_collateral_factors: bigint;
    liquidated_reserve: {
        /**
         * 0 <= native_collateral_factor < 100n
         */
        native_collateral_factor_pct: bigint;
        /**
         * 0 <= native_collateral_factor < 100n
         */
        native_liquidation_bonus_factor_pct: bigint;
    };
    allow_out_of_boundary_hf_for_test?: boolean;
};

export type CalcMaxLiquidableValueParams = {
    repaid_reserve: {
        repaid_value_native_usd: bigint;
        debt_value_native_usd: bigint;
    };
    liquidated_reserve: {
        collateral_value_native_usd: bigint;
        liquidation_bonus_factor_pct: bigint;
    };
};

export enum MaxLiquidableReason {
    RepaidValue = `RepaidValue`,
    DebtValue = `DebtValue`,
    CollateralValue = `CollateralValue`,
}

export class Liquidation {
    /**
     * Calculates the amount that can be repaid for a given liquidation
     * where `target_hf_pct` is the target health factor percentage.
     *
     * RV_repaid_asset =
     * (-target_hf * ΣDV_repaid_asset + Σ(CF_liquidated_asset_i * CV_liquidated_asset_i))
     * / (CF_liquidated_asset * (1 + LF_liquidated_asset) - target_hf)
     *
     * @returns the value in native usd scale that can recover the health factor back to `target_hf_pct`.
     * The value needs to be fed into `calc_max_liquidable_value` again to calculate the final liquidable value.
     */
    static calc_repaid_value({
        target_hf_pct,
        native_usd_sum_of_debts_without_borrow_factors,
        native_usd_sum_of_collaterals_with_collateral_factors,
        liquidated_reserve: { native_collateral_factor_pct, native_liquidation_bonus_factor_pct },
        allow_out_of_boundary_hf_for_test = false,
    }: CalcRepaidValueParams) {
        if (!allow_out_of_boundary_hf_for_test && (0n > target_hf_pct || target_hf_pct >= 100n)) {
            throw new Error('target_hf_pct must be between 0 and 100');
        }

        if (0n > native_collateral_factor_pct || native_collateral_factor_pct >= 100n) {
            throw new Error('native_collateral_factor_pct must be between 0 and 100');
        }

        if (0n > native_liquidation_bonus_factor_pct || native_liquidation_bonus_factor_pct >= 100n) {
            throw new Error('native_liquidation_bonus_factor_pct must be between 0 and 100');
        }

        if (native_usd_sum_of_debts_without_borrow_factors <= 0n) {
            throw new Error('native_usd_sum_of_debts_without_borrow_factors must be greater than 0');
        }

        if (native_usd_sum_of_collaterals_with_collateral_factors <= 0n) {
            throw new Error('native_usd_sum_of_collaterals_with_collateral_factors must be greater than 0');
        }

        const scaled_target_hf_pct = ScMath.uint_scale_pct(target_hf_pct);
        const scaled_liquidated_reserve = {
            collateral_factor: ScMath.uint_scale_pct(native_collateral_factor_pct),
            liquidation_bonus_factor: ScMath.uint_scale_pct(native_liquidation_bonus_factor_pct),
        };

        // unit: USD
        const numerator =
            ScMath.bigint_mul(native_usd_sum_of_debts_without_borrow_factors, -scaled_target_hf_pct) +
            native_usd_sum_of_collaterals_with_collateral_factors;

        // unit: ScMath.SCALE
        const denominator =
            ScMath.bigint_mul(
                scaled_liquidated_reserve.collateral_factor,
                ScMath.SCALE + scaled_liquidated_reserve.liquidation_bonus_factor,
            ) - scaled_target_hf_pct;

        // unit: USD
        const rv_repaid_asset = ScMath.bigint_div(numerator, denominator);

        // will need to adjust to the native scale of the asset by dividing or multiplying by the number of decimal places
        return rv_repaid_asset;
    }

    /**
     * min(RV_repaid_asset, min(DV_repaid_asset, (CV_liquidated_asset / (1 + LF_liquidated_asset))))
     * Sometimes, it wouldn't be possible to pay back all of RV_repaid_asset due to specific reasons.
     * Calculates the maximum liquidable value.
     *
     * Returned value is in native usd scale.
     */
    static calc_max_liquidable_value({ repaid_reserve, liquidated_reserve }: CalcMaxLiquidableValueParams) {
        const cv_liquidated_asset = liquidated_reserve.collateral_value_native_usd;
        const scaled_lf_liquidated_asset_pct = ScMath.uint_scale_pct(liquidated_reserve.liquidation_bonus_factor_pct);

        const max_caputurable_collateral_native_usd = ScMath.bigint_div(
            cv_liquidated_asset,
            ScMath.SCALE + scaled_lf_liquidated_asset_pct,
        );

        const max_liquidable_value = Liquidation.bigint_min(
            repaid_reserve.repaid_value_native_usd,
            repaid_reserve.debt_value_native_usd,
            max_caputurable_collateral_native_usd,
        );

        if (max_liquidable_value == repaid_reserve.repaid_value_native_usd) {
            return {
                value: max_liquidable_value,
                reason: MaxLiquidableReason.RepaidValue,
            };
        }

        if (max_liquidable_value == repaid_reserve.debt_value_native_usd) {
            return {
                value: max_liquidable_value,
                reason: MaxLiquidableReason.DebtValue,
            };
        }

        return {
            value: max_liquidable_value,
            reason: MaxLiquidableReason.CollateralValue,
        };
    }
}
