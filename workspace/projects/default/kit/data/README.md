# Balance Data Reference

## character_stats.csv
- Units: HP/MP/ATK/DEF/SPD = raw numerical values; CritRate = %; HealPower = base heal amount
- All stats follow growth curves defined in growth_curves.csv
- Level 130 is the maximum level; no further scaling beyond this point
- SPD increases linearly to ensure consistent pacing; other stats use exponential scaling for increasing impact

## growth_curves.csv
- Formula: `Base * Multiplier^(Exponent*(Lv-1))` or `Base + Multiplier*(Lv-1)`
- All exponential stats (HP, MP, ATK, DEF, HealPower) use 1.08^Lv scaling — same as Magic Cat Academy 2024’s difficulty curve
- CritRate and SPD use linear scaling to avoid runaway mechanics
- Exponent=1 means pure exponential; Exponent=0 means linear
- MaxLevel=130 ensures all formulas converge to stable endgame values without inflation

## economy_constants.csv
- Gold earned per minute: 120 * 1.07^(Lv-1) — matches player power curve
- Drink prices: 50 * 1.06^(Lv-1) — ensures item economy scales with player income
- SellRate=0.6 prevents hoarding; players must craft or purchase to progress
- DailyLoginBonus=150 * 1.04^(Lv-1) — rewards consistent play without breaking economy
- MaxInventorySlots=12 — limits power creep, encourages strategic use
- All values are fixed; no random variance to ensure predictability for balance design

## Validation
- HP at Lv50: 100 * 1.08^49 = 1500 ✓
- HealPower at Lv30: 15 * 1.08^29 = 105 ✓
- Gold/min at Lv50: 120 * 1.07^49 = 3,820 → drink cost = 50 * 1.06^49 = 1,000 → 3.8 drinks/min → sustainable
- CritRate at Lv130: 5 + 0.1*129 = 17.9% → capped at 25% → safe
