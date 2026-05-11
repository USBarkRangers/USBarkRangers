const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './03-tests/playwright',
    outputDir: './03-tests/results',
    webServer: {
        command: 'python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        url: 'http://localhost:4173/index.html',
        reuseExistingServer: true,
        timeout: 10000
    },
    use: {
        serviceWorkers: 'block'
    }
});
