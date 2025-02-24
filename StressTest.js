import axios from 'axios';
import cliProgress from 'cli-progress';
import colors from 'colors';

export class StressTest {
  constructor(options) {
    this.options = options;
    this.metrics = {
      successCount: 0,
      failureCount: 0,
      totalLatency: 0,
      minLatency: Infinity,
      maxLatency: 0
    };

    this.progressBar = new cliProgress.SingleBar({
      format: 'Progress |' + colors.cyan('{bar}') + '| {percentage}% || {value}/{total} Requests',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591'
    });
  }

  async makeRequest(config) {
    const startTime = Date.now();
    try {
      const requestConfig = config || {
        method: this.options.method,
        url: this.options.url,
        headers: this.options.headers ? (typeof this.options.headers === 'string' ? JSON.parse(this.options.headers) : this.options.headers) : {},
        data: this.options.data ? (typeof this.options.data === 'string' ? JSON.parse(this.options.data) : this.options.data) : undefined
      };

      await axios(requestConfig);
      const latency = Date.now() - startTime;

      this.metrics.successCount++;
      this.metrics.totalLatency += latency;
      this.metrics.minLatency = Math.min(this.metrics.minLatency, latency);
      this.metrics.maxLatency = Math.max(this.metrics.maxLatency, latency);

    } catch (error) {
      this.metrics.failureCount++;
    }
  }

  async run(apiConfig) {
    const totalRequests = parseInt(this.options.number);
    const concurrentUsers = parseInt(this.options.concurrent);

    console.log('\nStarting stress test with following configuration:'.cyan);
    console.log(`URL: ${this.options.url}`);
    console.log(`Total Requests: ${totalRequests}`);
    console.log(`Concurrent Users: ${concurrentUsers}`);
    console.log(`HTTP Method: ${this.options.method}\n`);

    this.progressBar.start(totalRequests, 0);

    // Create batches of concurrent requests
    for (let i = 0; i < totalRequests; i += concurrentUsers) {
      const batchSize = Math.min(concurrentUsers, totalRequests - i);
      const batch = Array(batchSize).fill().map(() => this.makeRequest(apiConfig));
      await Promise.all(batch);
      this.progressBar.update(i + batchSize);
    }

    this.progressBar.stop();

    this.displayResults(totalRequests);
  }

  displayResults(totalRequests) {
    const avgLatency = this.metrics.totalLatency / this.metrics.successCount || 0;

    console.log('\nTest Results:'.green);
    console.log('============'.green);
    console.log(`Total Requests: ${totalRequests}`);
    console.log(`Successful Requests: ${this.metrics.successCount}`.green);
    console.log(`Failed Requests: ${this.metrics.failureCount}`.red);
    console.log(`Success Rate: ${((this.metrics.successCount / totalRequests) * 100).toFixed(2)}%`);
    console.log('\nLatency Statistics:'.yellow);
    console.log(`Minimum: ${this.metrics.minLatency}ms`);
    console.log(`Maximum: ${this.metrics.maxLatency}ms`);
    console.log(`Average: ${avgLatency.toFixed(2)}ms`);
  }
}
