const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');

function createClassList() {
    return {
        add() {},
        remove() {},
        toggle() {}
    };
}

function createMarker(parkData) {
    const listeners = new Map();
    let latLng = { lat: Number(parkData.lat), lng: Number(parkData.lng) };
    return {
        _parkData: parkData,
        _icon: null,
        on(name, listener) {
            listeners.set(name, listener);
            return this;
        },
        fire(name, payload) {
            const listener = listeners.get(name);
            if (listener) listener.call(this, payload);
            return this;
        },
        getLatLng() {
            return latLng;
        },
        setLatLng(next) {
            latLng = { lat: Number(next[0]), lng: Number(next[1]) };
        }
    };
}

function createLayer() {
    const layers = new Set();
    return {
        addCalls: 0,
        addLayersCalls: 0,
        addLayer(marker) {
            this.addCalls++;
            layers.add(marker);
            marker._icon = {
                classList: createClassList(),
                style: { setProperty() {} }
            };
            marker.fire('add');
        },
        addLayers(markers) {
            this.addLayersCalls += markers.length;
            markers.forEach(marker => layers.add(marker));
        },
        removeLayer(marker) {
            layers.delete(marker);
            marker._icon = null;
            marker.fire('remove');
        },
        removeLayers(markers) {
            markers.forEach(marker => layers.delete(marker));
        },
        clearLayers() {
            layers.forEach(marker => { marker._icon = null; });
            layers.clear();
        },
        hasLayer(marker) {
            return layers.has(marker);
        },
        get size() {
            return layers.size;
        },
        refreshClusters() {}
    };
}

function makePoints(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `park-${index}`,
        name: `Park ${index}`,
        state: 'KS',
        cost: 'Free',
        swagType: 'Tag',
        info: '',
        website: '',
        pics: '',
        video: '',
        lat: 39.8 + (index * 0.00001),
        lng: -98.5 + (index * 0.00001),
        parkCategory: index % 2 === 0 ? 'National' : 'State',
        category: 'Park'
    }));
}

test('plain mode keeps 2,426 individual pins off the DOM and promotes only the selected pin', () => {
    const plainLayer = createLayer();
    const clusterLayer = createLayer();
    const canvasLayer = {
        points: [],
        activeMarker: null,
        redrawRequests: 0,
        setMarkerManager(manager) { this.manager = manager; },
        setPoints(points) { this.points = points; },
        setActiveMarker(marker) { this.activeMarker = marker; },
        requestRedraw() { this.redrawRequests++; }
    };
    const attachedLayers = new Set([plainLayer, canvasLayer]);
    const map = {
        getZoom: () => 7,
        hasLayer: layer => attachedLayers.has(layer),
        addLayer: layer => attachedLayers.add(layer),
        removeLayer: layer => attachedLayers.delete(layer)
    };
    const bark = {
        repos: {},
        getMarkerLayerPolicy: () => ({ layerType: 'plain', cullPlainMarkers: false }),
        renderMarkerClickPanel({ marker }) { bark.activePinMarker = marker; },
        clearActivePin() { bark.activePinMarker = null; },
        activePinMarker: null,
        services: {}
    };
    const context = {
        window: { BARK: bark },
        document: { getElementById: () => null },
        MapMarkerConfig: {
            createCustomMarker: createMarker,
            getPinStyle: parkData => ({
                iconUrl: parkData.parkCategory === 'National' ? 'national.jpeg' : 'state.jpeg',
                ringColor: '#000',
                pinColor: '#000',
                pinShadowColor: '#000',
                categoryClass: parkData.parkCategory === 'National' ? 'cat-national' : 'cat-state'
            })
        },
        console
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'modules', 'MarkerLayerManager.js'), 'utf8'),
        context,
        { filename: 'modules/MarkerLayerManager.js' }
    );

    const manager = new context.window.BARK.MarkerLayerManager({ map, plainLayer, clusterLayer, canvasLayer });
    const points = makePoints(2426);
    manager.sync(points, { applyLayers: false });
    points.forEach(point => { point.marker._barkIsVisible = true; });
    manager.applyVisibility(points, { forceReset: true });

    assert.equal(canvasLayer.points.length, 2426);
    assert.equal(plainLayer.size, 0, 'bulk pins must not create DOM markers');
    assert.equal(plainLayer.addCalls, 0);
    assert.equal(clusterLayer.addLayersCalls, 0, 'plain mode must not silently enable clustering');

    points[1200].marker.fire('click');

    assert.equal(plainLayer.size, 1, 'only the selected pin uses the original DOM structure');
    assert.equal(plainLayer.addCalls, 1);
    assert.equal(canvasLayer.activeMarker, points[1200].marker);
    assert.equal(bark.activePinMarker, points[1200].marker);

    manager.applyVisibility(points, { forceReset: true });
    assert.equal(plainLayer.size, 1, 'a forced rebuild preserves the selected original pin');
    assert.equal(canvasLayer.activeMarker, points[1200].marker);
});

test('canvas renderer draws and hit-tests all individual pins through one canvas', () => {
    const context2d = {
        arcCalls: 0,
        setTransform() {},
        clearRect() {},
        save() {},
        restore() {},
        beginPath() {},
        arc() { this.arcCalls++; },
        fill() {},
        stroke() {},
        drawImage() {},
        clip() {},
        scale() {}
    };
    const canvas = {
        width: 0,
        height: 0,
        style: {},
        parentNode: null,
        setAttribute() {},
        getContext: () => context2d
    };
    const pane = {
        firstChild: null,
        appendChild(node) { node.parentNode = this; },
        insertBefore(node) { node.parentNode = this; },
        removeChild(node) { node.parentNode = null; }
    };
    const handlers = new Map();
    const map = {
        getPane: () => pane,
        on(names, listener) { names.split(' ').forEach(name => handlers.set(name, listener)); },
        off(names) { names.split(' ').forEach(name => handlers.delete(name)); },
        getSize: () => ({ x: 390, y: 844 }),
        containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
        latLngToContainerPoint: () => ({ x: 195, y: 422 })
    };
    const vmContext = {
        window: {
            BARK: {},
            devicePixelRatio: 3,
            requestAnimationFrame: () => 1,
            cancelAnimationFrame() {},
            setTimeout
        },
        document: { createElement: () => canvas },
        L: {
            Layer: class {},
            DomUtil: {
                create: () => canvas,
                setPosition() {}
            }
        },
        performance,
        console
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'modules', 'CanvasMarkerLayer.js'), 'utf8'),
        vmContext,
        { filename: 'modules/CanvasMarkerLayer.js' }
    );

    const CanvasMarkerLayer = vmContext.window.BARK.CanvasMarkerLayer;
    const layer = new CanvasMarkerLayer();
    const points = makePoints(2426).map(point => {
        point.marker = createMarker(point);
        point.marker._barkIsVisible = true;
        return point;
    });
    let clickedMarker = null;
    points[2425].marker.on('click', function () { clickedMarker = this; });
    layer.setMarkerManager({
        getCanvasMarkerVisualState: () => ({
            iconUrl: 'missing.jpeg',
            ringColor: '#2196F3',
            shadowColor: 'rgba(0,0,0,.4)',
            visited: false,
            hiddenByTrip: false
        })
    });
    layer.setPoints(points);
    layer.onAdd(map);

    const result = layer.redrawNow();
    assert.equal(result.drawn, 2426);
    assert.equal(layer._drawnTargets.length, 2426);
    assert.equal(context2d.arcCalls, 2426);

    handlers.get('click')({ containerPoint: { x: 195, y: 422 }, originalEvent: { target: null } });
    assert.equal(clickedMarker, points[2425].marker, 'topmost individual pin remains tappable');
});
