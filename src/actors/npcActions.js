/**
 * NPC action re-exports — movement and interactions live in domain/entityActions.js.
 */
export {
    isMoveDirectionAction,
    moveDirectionAction,
} from '../domain/entityActions.js';
export { tickEntityAction } from './actionExecutor.js';
