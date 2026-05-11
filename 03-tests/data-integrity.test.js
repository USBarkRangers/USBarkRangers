const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const csvFiles = [
    {
        path: path.join(repoRoot, '02-data', 'data', 'data.csv'),
        header: 'name,state,swagType,lat,lng,info,website'
    },
    {
        path: path.join(repoRoot, '02-data', 'data', 'sheet_data_fetched.csv'),
        header: 'Location,State,Swag Cost,Type, Useful/Important/Other Info,Website,"Swag Pics - If available, and may not be current.",lat,lng'
    }
];

const hostedFallbackCsv = {
    path: path.join(repoRoot, '01-code', 'app', 'assets', 'data', 'bark-fallback.csv'),
    requiredHeaders: ['Location', 'State', 'lat', 'lng', 'Park id']
};

test('repo CSV data files do not contain unresolved git conflict markers', () => {
    for (const file of csvFiles) {
        const contents = fs.readFileSync(file.path, 'utf8');
        assert.doesNotMatch(contents, /^(<<<<<<<|=======|>>>>>>>) /m, `${file.path} contains conflict markers`);
    }
});

test('repo CSV data files keep their expected headers after conflict repair', () => {
    for (const file of csvFiles) {
        const firstLine = fs.readFileSync(file.path, 'utf8').split(/\r?\n/, 1)[0];
        assert.equal(firstLine, file.header, `${file.path} header changed unexpectedly`);
    }
});

test('hosted fallback CSV is deployable and contains canonical park ids', () => {
    const contents = fs.readFileSync(hostedFallbackCsv.path, 'utf8');
    assert.doesNotMatch(contents, /^(<<<<<<<|=======|>>>>>>>) /m, `${hostedFallbackCsv.path} contains conflict markers`);

    const firstLine = contents.split(/\r?\n/, 1)[0];
    for (const header of hostedFallbackCsv.requiredHeaders) {
        assert.match(firstLine, new RegExp(`(^|,)${header}(,|$)`, 'i'), `${hostedFallbackCsv.path} is missing ${header}`);
    }

    const lineCount = contents.split(/\r?\n/).filter(Boolean).length;
    assert.ok(lineCount > 300, `${hostedFallbackCsv.path} should contain the official fallback dataset`);
});

test('hosted fallback CSV keeps coordinates for Cliffs of the Neuse', () => {
    const contents = fs.readFileSync(hostedFallbackCsv.path, 'utf8');
    const cliffsLine = contents.split(/\r?\n/).find(line => line.startsWith('Cliffs of the Neuse State Park,'));

    assert.ok(cliffsLine, 'Cliffs of the Neuse State Park must be present in the hosted fallback CSV');
    assert.match(cliffsLine, /,35\.2354,-77\.8932,/, 'Cliffs of the Neuse State Park must keep its lat/lng populated');
});

test('hosted fallback CSV separates Fort Caroline and Kingsley Plantation coordinates', () => {
    const contents = fs.readFileSync(hostedFallbackCsv.path, 'utf8');

    assert.match(
        contents,
        /Fort Caroline\/Timucuan Ecological and Historical Preserve[\s\S]*?,30\.385948,-81\.497541,[\s\S]*?b7b26034-7d2c-4c3e-9901-29e1b5751230/,
        'Fort Caroline must use the NPS Fort Caroline coordinates'
    );
    assert.match(
        contents,
        /Timucuan Ecological and Historical Preserve Kingsley Plantation[\s\S]*?,30\.439983,-81\.437833,[\s\S]*?f1bf6d46-3919-4c0c-838d-555ca47155d2/,
        'Kingsley Plantation must use separate Kingsley coordinates'
    );
});
