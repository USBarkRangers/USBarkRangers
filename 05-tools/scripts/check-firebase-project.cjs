'use strict';
const EXPECTED_PROJECT = 'barkrangermap-auth';
function assertProject(project) {
    if (project !== EXPECTED_PROJECT) {
        throw new Error(`Bark Ranger deployment requires ${EXPECTED_PROJECT}; received ${project || '(missing project)'}.`);
    }
}
module.exports = { assertProject, EXPECTED_PROJECT };
if (require.main === module) {
    try { assertProject(process.argv[2]); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
