'use strict';

const EXPECTED_PROJECT = 'bark-ranger-ios';

function assertNativeProject(project) {
    if (project !== EXPECTED_PROJECT) {
        throw new Error(`Native iOS deployment requires ${EXPECTED_PROJECT}; received ${project || '(missing project)'}.`);
    }
}

module.exports = { assertNativeProject, EXPECTED_PROJECT };

if (require.main === module) {
    try {
        assertNativeProject(process.argv[2]);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
