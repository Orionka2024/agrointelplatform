#!/usr/bin/env node
/**
 * CI skill gate and driver permutation check (P1-3, F-01, F-02).
 * Fails with exit code 1 if any forecast horizon fails to beat naive or seasonal-naive
 * on held-out MAE without displaying the corresponding honest badge.
 */
import process from 'node:process';
import { officialHistory, officialDrivers, officialForecast } from '../shared/officialData.js';
import { verifySkillGate, runDriverPermutationTest } from '../shared/officialForecast.js';

const gate = verifySkillGate(officialForecast);
const permLead3 = runDriverPermutationTest(
  officialHistory.producer.monthly,
  officialDrivers,
  officialHistory.retail.weekly,
  { lead: 3, permutations: 25, seed: 42 }
);
const permLead6 = runDriverPermutationTest(
  officialHistory.producer.monthly,
  officialDrivers,
  officialHistory.retail.weekly,
  { lead: 6, permutations: 25, seed: 42 }
);

console.log(
  JSON.stringify(
    {
      skillGate: gate,
      permutationTests: {
        lead3: permLead3,
        lead6: permLead6,
      },
    },
    null,
    2
  )
);

if (!gate.ok) {
  console.error('CI skill gate failed: dishonest horizon badges detected.');
  process.exit(1);
}
