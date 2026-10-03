import assert from 'node:assert/strict';
import {fundedFeeCap,assertFeeCap} from './evolution-fees';
const options={gasUnits:20n,balance:1000n,reserve:100n,baseFee:20n,priority:5n,recommended:70n};
const capped=fundedFeeCap(options);assert.equal(capped,45n);assert.ok(capped*options.gasUnits+options.reserve<=options.balance);assertFeeCap(options.baseFee,options.priority,capped);
assert.equal(fundedFeeCap({...options,recommended:30n}),33n);
assert.throws(()=>fundedFeeCap({...options,baseFee:40n}));assert.throws(()=>fundedFeeCap({...options,balance:100n}));assert.throws(()=>assertFeeCap(41n,5n,45n));assert.throws(()=>assertFeeCap(null,5n,45n));
console.log('Funded fee caps preserve the reserve, retain network headroom and reject unaffordable or stale fees');
