/**
 * 单位转换常量
 */
export const KG_TO_LBS = 2.20462;
export const KMH_TO_MPH = 0.621371;

/**
 * 休息计时器默认时间（秒）
 */
export const DEFAULT_REST_TIME = 90;

/**
 * 计时器提示音效 URL
 */
export const TIMER_SOUND_URL = 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg';

/**
 * 播放计时器提示音
 */
export const playTimerSound = () => {
  try {
    const audio = new Audio(TIMER_SOUND_URL);
    audio.play();
  } catch (e) {
    console.error("Audio play failed", e);
  }
};
