const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadParkRepo() {
    const context = { console, Map, Set, Object, Array, String, Math, Number, RegExp };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(ROOT, '01-code', 'app', 'repos', 'ParkRepo.js'), 'utf8'),
        context,
        { filename: 'repos/ParkRepo.js' }
    );
    return context.window.BARK.repos.ParkRepo;
}

function makePark(overrides = {}) {
    return {
        id: 'b7b26034-7d2c-4c3e-9901-29e1b5751230',
        name: 'Fort Caroline',
        state: 'Florida',
        cost: 'Free',
        swagType: 'Tag',
        info: 'Original spreadsheet information',
        website: 'https://example.test/park',
        pics: '',
        video: '',
        lat: 30.385948,
        lng: -81.497541,
        parkCategory: 'National',
        category: 'National',
        _cachedNormalizedName: 'fort caroline',
        ...overrides
    };
}

test('unchanged spreadsheet rows retain park objects and do not advance the map revision', () => {
    const repo = loadParkRepo();
    const original = makePark();
    repo.replaceAll([original]);
    const revision = repo.getRevision();

    const result = repo.replaceAll([makePark()]);

    assert.equal(result.unchanged, true);
    assert.equal(repo.getRevision(), revision);
    assert.equal(repo.getAll()[0], original);
});

test('changed spreadsheet fields publish a new park object and advance the map revision', () => {
    const repo = loadParkRepo();
    const original = makePark();
    repo.replaceAll([original]);
    const revision = repo.getRevision();
    const updated = makePark({ info: 'Updated automatically from the spreadsheet' });

    const result = repo.replaceAll([updated]);

    assert.equal(result.unchanged, undefined);
    assert.equal(result.changed.has(original.id), true);
    assert.equal(repo.getRevision(), revision + 1);
    assert.equal(repo.getAll()[0], updated);
    assert.equal(repo.getById(original.id).info, 'Updated automatically from the spreadsheet');
});
