import assert from 'node:assert/strict';

/** EIP-1559 recommendation is not a minimum price. Keep the reviewed maximum
 * fully funded, with headroom above the actual base fee plus the chosen tip. */
export function fundedFeeCap({gasUnits,balance,reserve,baseFee,priority,recommended}:{gasUnits:bigint;balance:bigint;reserve:bigint;baseFee:bigint;priority:bigint;recommended:bigint}):bigint {
  assert.ok(gasUnits>0n && baseFee>0n && priority>0n && recommended>0n);
  assert.ok(balance>reserve,'Owner wallet does not cover the gas reserve');
  const affordable=(balance-reserve)/gasUnits,recommendation=recommended*11n/10n;
  const cap=affordable<recommendation?affordable:recommendation;
  assert.ok(cap>=(baseFee+priority)*12n/10n,'Funded gas cap does not cover current network fees with headroom');
  return cap;
}
export function assertFeeCap(baseFee:bigint|null|undefined,priority:bigint,cap:bigint):void {
  assert.ok(baseFee && baseFee>0n,'A current EIP-1559 base fee is required');
  assert.ok(priority>0n && cap>=baseFee+priority,'Current base fee plus tip exceeds the reviewed gas cap');
}
