/**
 * Wraps async route handlers to pass errors to next() instead of throwing.
 * Usage: router.get('/', asyncHandler(controller.getItems));
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
