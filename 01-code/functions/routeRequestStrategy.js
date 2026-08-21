/**
 * Policy for the inexpensive route path and its off-road recovery path.
 */
function getHttpStatus(error) {
    const status = error && error.response ? Number(error.response.status) : Number(error && error.status);
    return Number.isFinite(status) ? status : null;
}

function shouldAttemptSnapRecovery(error) {
    return [400, 404, 422].includes(getHttpStatus(error));
}

function routeCoordinatesChanged(first, second) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return true;
    return first.some((coordinate, index) => (
        !Array.isArray(coordinate) ||
        !Array.isArray(second[index]) ||
        Number(coordinate[0]) !== Number(second[index][0]) ||
        Number(coordinate[1]) !== Number(second[index][1])
    ));
}

module.exports = {
    routeCoordinatesChanged,
    shouldAttemptSnapRecovery
};
