/**
 * @deprecated Import from `./brain/index.js` or specific `./brain/*Impl/*` modules.
 * Re-export barrel for backward compatibility.
 */
export {
    attachNpcBrain,
    NoopNpcBrain,
    noopNpcBrain,
    WanderBrain,
    createWanderBrain,
    NpcTaskBrain,
    createTaskBrain,
    createDefaultTaskBrain,
    ThomasBrain,
    createThomasBrain,
} from './brain/index.js';

export {};
