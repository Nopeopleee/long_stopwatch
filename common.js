const THEME_KEY="dipai-theme";
const systemThemeQuery=matchMedia("(prefers-color-scheme: light)");

function getThemePreference(){
  const value=localStorage.getItem(THEME_KEY);
  return["system","light","dark"].includes(value)?value:"system";
}

function resolveTheme(preference=getThemePreference()){
  return preference==="system"?(systemThemeQuery.matches?"light":"dark"):preference;
}

function applyTheme(preference=getThemePreference()){
  const resolved=resolveTheme(preference);
  document.documentElement.dataset.theme=resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",resolved==="light"?"#f4f6fb":"#0b0d10");
  document.querySelectorAll(".theme-option").forEach(btn=>btn.setAttribute("aria-pressed",String(btn.dataset.themeValue===preference)));
}

function setThemePreference(preference){
  if(!["system","light","dark"].includes(preference))return;
  localStorage.setItem(THEME_KEY,preference);
  applyTheme(preference);
}

systemThemeQuery.addEventListener?.("change",()=>{
  if(getThemePreference()==="system")applyTheme("system");
});

applyTheme();
