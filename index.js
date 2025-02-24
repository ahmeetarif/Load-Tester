#!/usr/bin/env node

import { program } from 'commander';
import { StressTest } from './StressTest.js';

// Configure CLI options
program
  .version('1.0.0')
  .requiredOption('-u, --url <url>', 'Target URL to stress test')
  .option('-n, --number <number>', 'Number of requests to send', '100')
  .option('-c, --concurrent <number>', 'Number of concurrent users', '10')
  .option('-m, --method <method>', 'HTTP method to use', 'GET')
  .option('-d, --data <data>', 'Request body data in JSON format')
  .option('-h, --headers <headers>', 'Custom headers in JSON format')
  .parse(process.argv);

const options = program.opts();
const stressTest = new StressTest(options);

// Run the stress test
stressTest.run().catch(console.error);
