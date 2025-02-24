import { StressTest } from './StressTest.js';

const options = {
    method: 'POST',
    url: 'https://api.dropyonline.com/api/v1/auth/login',
    headers: {
        'Content-Type': 'application/json'
    },
    data: {
        email: 'NO',
        password: 'NO'
    },
    number: '1000',
    concurrent: '10',
    rampUpTime: 10,
    monitoringInterval: 1000,
    successThreshold: 95,
    maxResponseTime: 2000
};

const stressTest = new StressTest(options);

stressTest.run()
    .catch(error => {
        console.error('Test Failed:', error.message);
        process.exit(1);
    });
