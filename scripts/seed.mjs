// Loads the demo dataset (replaces existing data, keeps paired devices): npm run seed
import '../server/env.mjs';
import { seedDemo } from '../server/seed.mjs';

const counts = seedDemo();
console.log(`Demo data loaded: ${counts.readings} readings, ${counts.episodes} symptom check, ${counts.meds} medicines.`);
console.log('Story: 30 days of stable baseline → 2 days of rising resting HR / falling HRV → fever today (post-monsoon).');
console.log('Hidden trap for the medicine checker: Dolo 650 + Sinarest both contain paracetamol.');
