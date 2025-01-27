import { GameResponse } from '@hotandcold/classic-shared';

export let GAME_INIT_DATA: GameResponse | undefined = undefined;

const initListener = (ev: MessageEvent) => {
  if (ev.data?.data?.message?.type === 'INIT') {
    GAME_INIT_DATA = ev.data.data.message.payload;
    window.removeEventListener('message', initListener);
  }
};

window.addEventListener('message', initListener);
