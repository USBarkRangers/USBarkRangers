const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appDir = path.join(__dirname, '..', '01-code', 'app');

test('loader dismissal fades its content without making the cover transparent', () => {
    const scheduled = [];
    const classes = new Set();
    const loader = {
        dataset: {},
        style: {},
        classList: {
            add(name) {
                classes.add(name);
            }
        },
        remove() {
            this.removed = true;
        }
    };
    const context = {
        window: { BARK: {} },
        document: {
            getElementById(id) {
                return id === 'bark-loader' ? loader : null;
            }
        },
        setTimeout(callback, delay) {
            scheduled.push({ callback, delay });
            return scheduled.length;
        },
        console
    };
    context.window.window = context.window;
    context.window.document = context.document;
    context.window.setTimeout = context.setTimeout;

    vm.runInNewContext(
        fs.readFileSync(path.join(appDir, 'modules', 'mapEngine.js'), 'utf8'),
        context,
        { filename: 'modules/mapEngine.js' }
    );

    context.window.dismissBarkLoader();
    assert.equal(loader.dataset.dismissing, 'true');
    assert.equal(classes.has('is-dismissing'), true);
    assert.equal(loader.style.opacity, undefined);

    const removal = scheduled.find((entry) => entry.delay === 400);
    assert.ok(removal, 'loader removal should wait for the content fade');
    removal.callback();
    assert.equal(loader.removed, true);
});

test('loader CSS covers the dynamic viewport and only fades its children', () => {
    const styles = fs.readFileSync(path.join(appDir, 'styles.css'), 'utf8');
    const loaderRule = styles.match(/#bark-loader\s*\{[\s\S]*?\n\}/);
    assert.ok(loaderRule);
    assert.match(loaderRule[0], /inset:\s*0/);
    assert.match(loaderRule[0], /height:\s*100dvh/);
    assert.match(loaderRule[0], /opacity:\s*1/);
    assert.doesNotMatch(loaderRule[0], /transition:\s*opacity/);
    assert.match(styles, /#bark-loader\s*>\s*\*\s*\{[\s\S]*transition:\s*opacity\s*0\.35s/);
    assert.match(styles, /#bark-loader\.is-dismissing\s*>\s*\*\s*\{[\s\S]*opacity:\s*0/);
});
