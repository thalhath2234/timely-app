; Included by electron-builder.yml (nsis.include). A per-user uninstall
; removes the start-at-login entry Electron's setLoginItemSettings wrote
; (electron/supervisor/loginItem.ts): the Run value is named after the app id,
; and Task Manager › Startup apps keeps its on/off state under
; StartupApproved\Run. An update runs the old uninstaller too; it keeps both.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP_ID}"
  ${endIf}
!macroend
