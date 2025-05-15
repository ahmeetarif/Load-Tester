import axios from 'axios';
import cliProgress from 'cli-progress';
import colors from 'colors';

export class FlowLoader {
  constructor(options) {
    this.options = options;
    this.metrics = {
      flowMetrics: [],
      totalLatency: 0,
      minLatency: Infinity,
      maxLatency: 0,
      totalFlowTime: 0,
      minFlowTime: Infinity,
      maxFlowTime: 0
    };
    
    if (this.options.flow && Array.isArray(this.options.flow)) {
      this.options.flow.forEach((step, index) => {
        this.metrics.flowMetrics[index] = {
          name: step.name || `Step ${index + 1}`,
          successCount: 0,
          failureCount: 0,
          totalLatency: 0,
          minLatency: Infinity,
          maxLatency: 0
        };
      });
    }
    
    this.progressBar = new cliProgress.SingleBar({
      format: 'Progress |' + colors.cyan('{bar}') + '| {percentage}% || {value}/{total} Flows',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591'
    });
  }

  async makeRequest(config, stepIndex, flowStartTime, flowContext = {}) {
    const startTime = Date.now();
    const step = this.options.flow[stepIndex];
    
    try {
      const requestConfig = { ...config };
      
      if (typeof requestConfig.url === 'string') {
        requestConfig.url = this.replaceTemplateValues(requestConfig.url, flowContext);
      }
      
      if (requestConfig.headers) {
        Object.keys(requestConfig.headers).forEach(key => {
          requestConfig.headers[key] = this.replaceTemplateValues(requestConfig.headers[key], flowContext);
        });
      }
      
      if (requestConfig.data) {
        if (typeof requestConfig.data === 'string') {
          requestConfig.data = this.replaceTemplateValues(requestConfig.data, flowContext);
        } else {
          requestConfig.data = JSON.parse(
            this.replaceTemplateValues(JSON.stringify(requestConfig.data), flowContext)
          );
        }
      }
      
      const response = await axios(requestConfig);
      const latency = Date.now() - startTime;
      
      let assertionsPassed = true;
      let assertionErrors = [];
      
      if (step.assertions && Array.isArray(step.assertions)) {
        for (const assertion of step.assertions) {
          try {
            const result = await this.runAssertion(assertion, response, flowContext);
            
            if (!result.passed) {
              assertionsPassed = false;
              assertionErrors.push(result.error);
            }
          } catch (error) {
            assertionsPassed = false;
            assertionErrors.push(`Assertion error: ${error.message}`);
          }
        }
      }
      
      const metrics = this.metrics.flowMetrics[stepIndex];
      if (assertionsPassed) {
        metrics.successCount++;
      } else {
        metrics.failureCount++;
        metrics.assertionFailures = (metrics.assertionFailures || 0) + 1;
      }
      
      metrics.totalLatency += latency;
      metrics.minLatency = Math.min(metrics.minLatency, latency);
      metrics.maxLatency = Math.max(metrics.maxLatency, latency);
      
      return {
        success: assertionsPassed,
        data: response.data,
        latency,
        statusCode: response.status,
        headers: response.headers,
        assertionErrors: assertionErrors.length > 0 ? assertionErrors : undefined
      };
    } catch (error) {
      this.metrics.flowMetrics[stepIndex].failureCount++;
      return {
        success: false,
        error: error.message,
        latency: Date.now() - startTime
      };
    }
  }
  
  async runAssertion(assertion, response, flowContext) {
    switch (assertion.type) {
      case 'statusCode':
        return {
          passed: response.status === assertion.value,
          error: response.status !== assertion.value ? 
            `Expected status ${assertion.value}, got ${response.status}` : null
        };
        
      case 'jsonPath':
        // Check a specific path in the JSON response
        try {
          const value = this.getValueByPath(response.data, assertion.path);
          
          // Handle different comparison operators
          switch (assertion.operator) {
            case 'equals':
              return {
                passed: value === assertion.value,
                error: value !== assertion.value ? 
                  `Expected ${assertion.path} to equal ${assertion.value}, got ${value}` : null
              };
            case 'contains':
              return {
                passed: value && value.includes && value.includes(assertion.value),
                error: !value || !value.includes || !value.includes(assertion.value) ? 
                  `Expected ${assertion.path} to contain ${assertion.value}` : null
              };
            case 'exists':
              return {
                passed: value !== undefined && value !== null,
                error: value === undefined || value === null ? 
                  `Expected ${assertion.path} to exist` : null
              };
            case 'notExists':
              return {
                passed: value === undefined || value === null,
                error: value !== undefined && value !== null ? 
                  `Expected ${assertion.path} to not exist` : null
              };
            case 'greaterThan':
              return {
                passed: value > assertion.value,
                error: value <= assertion.value ? 
                  `Expected ${assertion.path} to be greater than ${assertion.value}, got ${value}` : null
              };
            case 'lessThan':
              return {
                passed: value < assertion.value,
                error: value >= assertion.value ? 
                  `Expected ${assertion.path} to be less than ${assertion.value}, got ${value}` : null
              };
            case 'match':
              const regex = new RegExp(assertion.value);
              return {
                passed: regex.test(String(value)),
                error: !regex.test(String(value)) ? 
                  `Expected ${assertion.path} to match ${assertion.value}, got ${value}` : null
              };
            default:
              return {
                passed: false,
                error: `Unknown operator: ${assertion.operator}`
              };
          }
        } catch (error) {
          return {
            passed: false,
            error: `Failed to evaluate path ${assertion.path}: ${error.message}`
          };
        }
        
      case 'responseTime':
        const responseTime = response.config.metadata.responseTime;
        return {
          passed: responseTime <= assertion.value,
          error: responseTime > assertion.value ? 
            `Response time ${responseTime}ms exceeded threshold ${assertion.value}ms` : null
        };
        
      case 'header':
        const headerValue = response.headers[assertion.name];
        return {
          passed: assertion.value ? 
            headerValue === assertion.value : 
            headerValue !== undefined,
          error: assertion.value ? 
            (headerValue !== assertion.value ? 
              `Expected header ${assertion.name} to be ${assertion.value}, got ${headerValue}` : null) :
            (headerValue === undefined ? 
              `Expected header ${assertion.name} to exist` : null)
        };
      
      case 'custom':
        try {
          let assertFn = assertion.fn;
          if (typeof assertFn === 'string') {
            assertFn = new Function('response', 'context', assertFn);
          }
          
          const result = assertFn(response, flowContext);
          return {
            passed: result === true,
            error: result !== true ? 
              (typeof result === 'string' ? result : 'Custom assertion failed') : null
          };
        } catch (error) {
          return {
            passed: false,
            error: `Custom assertion error: ${error.message}`
          };
        }
        
      default:
        return {
          passed: false,
          error: `Unknown assertion type: ${assertion.type}`
        };
    }
  }
  
  getValueByPath(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current !== undefined && current !== null ? current[key] : undefined;
    }, obj);
  }
  
  replaceTemplateValues(str, context) {
    if (typeof str !== 'string') return str;
    
    return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const keyParts = key.split('.');
      let value = context;
      
      for (const part of keyParts) {
        if (value === undefined || value === null) return match;
        value = value[part];
      }
      
      return value !== undefined ? value : match;
    });
  }

  async executeFlow() {
    const flowStartTime = Date.now();
    const flowContext = {};
    let allStepsSuccessful = true;
    let flowAssertionFailures = 0;
    
    for (let i = 0; i < this.options.flow.length; i++) {
      const step = this.options.flow[i];
      const requestConfig = {
        method: step.method,
        url: step.url,
        headers: step.headers ? (typeof step.headers === 'string' ? JSON.parse(step.headers) : step.headers) : {},
        data: step.data ? (typeof step.data === 'string' ? JSON.parse(step.data) : step.data) : undefined
      };
      
      const result = await this.makeRequest(requestConfig, i, flowStartTime, flowContext);
      
      if (!result.success) {
        allStepsSuccessful = false;
        
        if (result.assertionErrors) {
          flowAssertionFailures++;
          
          if (this.options.verbose) {
            console.log(`\nAssertion failure in step ${step.name || i+1}:`.yellow);
            result.assertionErrors.forEach(err => console.log(`  - ${err}`.yellow));
          }
        }
        
        if (step.stopOnFailure !== false) {
          break;
        }
      }
      
      if (result.success && step.saveAs) {
        flowContext[step.saveAs] = result.data;
      }
      
      if (step.saveResponseAs) {
        flowContext[step.saveResponseAs] = {
          data: result.data,
          headers: result.headers,
          status: result.statusCode
        };
      }
    }
    
    const flowTime = Date.now() - flowStartTime;
    
    if (allStepsSuccessful) {
      this.metrics.successCount++;
      this.metrics.totalFlowTime += flowTime;
      this.metrics.minFlowTime = Math.min(this.metrics.minFlowTime, flowTime);
      this.metrics.maxFlowTime = Math.max(this.metrics.maxFlowTime, flowTime);
    } else {
      this.metrics.failureCount++;
      if (flowAssertionFailures > 0) {
        this.metrics.assertionFailures = (this.metrics.assertionFailures || 0) + 1;
      }
    }
    
    return { 
      success: allStepsSuccessful, 
      flowTime,
      assertionFailures: flowAssertionFailures
    };
  }

  async run() {
    if (!this.options.flow || !Array.isArray(this.options.flow) || this.options.flow.length === 0) {
      console.error('Error: Flow configuration is required and must be an array of steps'.red);
      return;
    }
    
    const totalFlows = parseInt(this.options.number) || 100;
    const concurrentUsers = parseInt(this.options.concurrent) || 10;
    
    console.log('\nStarting flow-based stress test with following configuration:'.cyan);
    console.log(`Total Flows: ${totalFlows}`);
    console.log(`Concurrent Users: ${concurrentUsers}`);
    console.log(`Flow Steps: ${this.options.flow.length}`);
    this.options.flow.forEach((step, i) => {
      console.log(`  ${i+1}. ${step.name || 'Unnamed Step'}: ${step.method} ${step.url}`);
    });
    console.log('');
    
    this.metrics.successCount = 0;
    this.metrics.failureCount = 0;
    
    this.progressBar.start(totalFlows, 0);
    
    for (let i = 0; i < totalFlows; i += concurrentUsers) {
      const batchSize = Math.min(concurrentUsers, totalFlows - i);
      const batch = Array(batchSize).fill().map(() => this.executeFlow());
      await Promise.all(batch);
      this.progressBar.update(i + batchSize);
    }
    
    this.progressBar.stop();
    this.displayResults(totalFlows);
  }

  displayResults(totalFlows) {
    console.log('\nTest Results:'.green);
    console.log('============'.green);
    console.log(`Total Flows: ${totalFlows}`);
    console.log(`Successful Flows: ${this.metrics.successCount}`.green);
    console.log(`Failed Flows: ${this.metrics.failureCount}`.red);
    
    if (this.metrics.assertionFailures) {
      console.log(`Flows With Assertion Failures: ${this.metrics.assertionFailures}`.yellow);
    }
    
    console.log(`Success Rate: ${((this.metrics.successCount / totalFlows) * 100).toFixed(2)}%`);
    
    if (this.metrics.successCount > 0) {
      const avgFlowTime = this.metrics.totalFlowTime / this.metrics.successCount;
      console.log('\nFlow Time Statistics:'.yellow);
      console.log(`Minimum: ${this.metrics.minFlowTime}ms`);
      console.log(`Maximum: ${this.metrics.maxFlowTime}ms`);
      console.log(`Average: ${avgFlowTime.toFixed(2)}ms`);
    }
    
    console.log('\nStep-by-Step Statistics:'.yellow);
    this.metrics.flowMetrics.forEach((stepMetric, index) => {
      const step = this.options.flow[index];
      console.log(`\n${stepMetric.name} (${step.method} ${step.url}):`);
      console.log(`  Success: ${stepMetric.successCount}, Failures: ${stepMetric.failureCount}`);
      
      if (stepMetric.assertionFailures) {
        console.log(`  Assertion Failures: ${stepMetric.assertionFailures}`.yellow);
      }
      
      if (stepMetric.successCount > 0) {
        const avgLatency = stepMetric.totalLatency / stepMetric.successCount;
        console.log(`  Min Latency: ${stepMetric.minLatency}ms`);
        console.log(`  Max Latency: ${stepMetric.maxLatency}ms`);
        console.log(`  Avg Latency: ${avgLatency.toFixed(2)}ms`);
      }
      
      if (this.options.verbose && step.assertions && Array.isArray(step.assertions)) {
        console.log(`  Assertions: ${step.assertions.length}`);
        step.assertions.forEach((assertion, i) => {
          let description = "";
          switch (assertion.type) {
            case 'statusCode':
              description = `Status code should be ${assertion.value}`;
              break;
            case 'jsonPath':
              description = `${assertion.path} should ${assertion.operator} ${assertion.value || ''}`;
              break;
            case 'responseTime':
              description = `Response time should be <= ${assertion.value}ms`;
              break;
            case 'header':
              description = `Header '${assertion.name}' should ${assertion.value ? `equal '${assertion.value}'` : 'exist'}`;
              break;
            case 'custom':
              description = 'Custom assertion';
              break;
          }
          console.log(`    ${i+1}. ${description}`);
        });
      }
    });
  }
}