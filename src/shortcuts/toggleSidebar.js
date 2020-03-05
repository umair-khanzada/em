import { store } from '../store.js'

export default {
  id: 'toggleSidebar',
  name: 'Toggle Recently Edited',
  svg: null,
  keyboard: { alt: true, key: 'r' },
  exec: () => {
    store.dispatch({ type: 'toggleSidebar', value: !store.getState().showSidebar })
  }
}
