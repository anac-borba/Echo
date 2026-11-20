// Open Bot Avatar (MIT) © Dominik Scholz — github.com/DominikScholz/open-bot-avatar (tipos removidos para rodar no navegador)
                                                                                                                                 
export { validateAvatar } from './validate.js';
export {
  avatarFrame,
  renderAvatarSvg,
  renderAvatarScene,
  sceneFrame,
  DEFAULT_COLOR,
  DEFAULT_DEPTH,
  DEFAULT_EYE_COLOR,
} from './render.js';
                                                                                                   
export { BASE_PITCH, BASE_YAW, blendPoses, computePose } from './motion.js';
                                                   
export { MOOD_MS, moodProgress, settleMood } from './mood.js';
                                           
export { REST, followGaze, followStep, pointerGaze } from './follow.js';
                                               
export { createAnimator } from './animator.js';
                                                                           
export { examples, getExample } from './examples.js';
