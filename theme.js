import {iconPaths} from './icons.js';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider,createTheme} from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import GlobalStyles from '@mui/material/GlobalStyles';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

const STORAGE_KEY='chrontab-appearance';
const modes=['light','dark','system'];
function savedMode() { try {const value=localStorage.getItem(STORAGE_KEY);return modes.includes(value) ? value : 'system';} catch {return 'system';} }
function resolvedMode(mode) {return mode==='system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;}
export function applyAppearance(mode) {
  document.documentElement.dataset.theme=resolvedMode(mode);
  document.documentElement.style.colorScheme=resolvedMode(mode);
}
applyAppearance(savedMode());
function Appearance() {
  const [mode,setMode]=React.useState(savedMode);
  const [systemDark,setSystemDark]=React.useState(matchMedia('(prefers-color-scheme: dark)').matches);
  React.useEffect(()=>{
    const media=matchMedia('(prefers-color-scheme: dark)');
    const change=event=>setSystemDark(event.matches);
    const storage=event=>{if(event.key===STORAGE_KEY)setMode(savedMode());};
    media.addEventListener('change',change);window.addEventListener('storage',storage);
    return ()=>{media.removeEventListener('change',change);window.removeEventListener('storage',storage);};
  },[]);
  const dark=mode==='dark' || mode==='system' && systemDark;
  React.useLayoutEffect(()=>{applyAppearance(mode);},[mode,systemDark]);
  const theme=React.useMemo(()=>createTheme({
    palette:{mode:dark ? 'dark':'light',primary:{main:dark ? '#d0bcff':'#6750a4'},background:{default:dark ? '#141218':'#f8f7fc',paper:dark ? '#211f26':'#fffbff'},text:{primary:dark ? '#e6e1e5':'#1d1b20',secondary:dark ? '#cac4d0':'#625b71'}},
    shape:{borderRadius:12},
    typography:{fontFamily:'"Segoe UI",Roboto,Arial,sans-serif',button:{textTransform:'none',fontWeight:600}},
    components:{MuiToggleButton:{styleOverrides:{root:{fontSize:11,padding:'6px 10px',lineHeight:1.7,borderColor:dark ? '#49454f':'#d9d2e3','&.Mui-selected':{backgroundColor:dark ? '#4f378b':'#eaddff',color:dark ? '#eaddff':'#21005d'}}}}}
  }),[dark]);
  return React.createElement(ThemeProvider,{theme},
    React.createElement(CssBaseline,{enableColorScheme:true}),
    React.createElement(GlobalStyles,{styles:{
      body:{backgroundColor:'var(--bg)',color:'var(--ink)',fontSize:14},
      'button,input,select':{fontFamily:theme.typography.fontFamily},
      '.MuiToggleButtonGroup-root':{backgroundColor:'var(--surface)',borderRadius:12},
      '.MuiToggleButton-root:focus-visible':{outline:'3px solid '+theme.palette.primary.main,outlineOffset:2},
      '::selection':{background:dark ? '#4f378b':'#eaddff',color:dark ? '#eaddff':'#21005d'}
    }}),
    React.createElement(ToggleButtonGroup,{value:mode,exclusive:true,size:'small','aria-label':'Appearance',onChange:(_,value)=>{
      if(!value)return;
      try{localStorage.setItem(STORAGE_KEY,value);}catch{}
      applyAppearance(value);setMode(value);
    }},modes.map(value=>React.createElement(ToggleButton,{key:value,value,'aria-label':value[0].toUpperCase()+value.slice(1)+' theme'},React.createElement('svg',{className:'mdi-icon','data-mdi':value,viewBox:'0 0 24 24','aria-hidden':'true',focusable:'false'},React.createElement('path',{d:iconPaths[value]})),value[0].toUpperCase()+value.slice(1))))
  );
}
const host=document.getElementById('theme-controls');
if(host)createRoot(host).render(React.createElement(Appearance));
