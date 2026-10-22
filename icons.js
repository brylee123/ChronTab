import {
  mdiAlarmSnooze,
  mdiOpenInNew,
  mdiTab,
  mdiWeatherNight,
  mdiSleep,
  mdiDatabaseCheckOutline,
  mdiImport,
  mdiExport,
  mdiPlus,
  mdiMagnify,
  mdiClose,
  mdiRepeat,
  mdiClockOutline,
  mdiChevronDown,
  mdiWeatherSunny,
  mdiThemeLightDark,
  mdiPlay,
  mdiPause,
  mdiPencilOutline,
  mdiDeleteOutline,
  mdiCalendarMonthOutline,
  mdiCloseCircle,
  mdiChevronLeft,
  mdiChevronRight,
  mdiFormatListBulleted,
  mdiCalendarMonth,
  mdiCalendarMultiple,
  mdiCalendarStar,
  mdiBriefcaseOutline,
  mdiFilterVariant,
  mdiFolderOutline,
} from '@mdi/js';
// Official, unmodified Pictogrammers Material Design Icons paths.
export const iconPaths = {
  logo: mdiAlarmSnooze,
  'open-in-new': mdiOpenInNew,
  tab: mdiTab,
  night: mdiWeatherNight,
  sleep: mdiSleep,
  'database-check': mdiDatabaseCheckOutline,
  import: mdiImport,
  export: mdiExport,
  plus: mdiPlus,
  search: mdiMagnify,
  close: mdiClose,
  repeat: mdiRepeat,
  clock: mdiClockOutline,
  'chevron-down': mdiChevronDown,
  light: mdiWeatherSunny,
  dark: mdiWeatherNight,
  system: mdiThemeLightDark,
  play: mdiPlay,
  pause: mdiPause,
  edit: mdiPencilOutline,
  delete: mdiDeleteOutline,
  calendar: mdiCalendarMonthOutline,
  'clear-search': mdiCloseCircle,
  left: mdiChevronLeft,
  right: mdiChevronRight,
  list: mdiFormatListBulleted,
  'calendar-view': mdiCalendarMonth,
  'date-lists': mdiCalendarMultiple,
  holiday: mdiCalendarStar,
  workday: mdiBriefcaseOutline,
  custom: mdiCalendarMonthOutline,
  filter: mdiFilterVariant,
  group: mdiFolderOutline,
};
export function iconMarkup(name) {
  const path = iconPaths[name];
  if (!path) {
    throw new Error('Unknown MDI icon: ' + name);
  }
  return (
    '<svg class="mdi-icon" data-mdi="' +
    name +
    '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' +
    path +
    '"></path></svg>'
  );
}
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((element) => {
    element.innerHTML = iconMarkup(element.dataset.icon);
    element.setAttribute('aria-hidden', 'true');
  });
}
