; Include from the Tauri NSIS installer template.
; Registers note:// for the current user and never requires elevation.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\note" "" "URL:Inkism Note"
  WriteRegStr HKCU "Software\Classes\note" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\note\DefaultIcon" "" "$INSTDIR\inkism.exe,0"
  WriteRegStr HKCU "Software\Classes\note\shell\open\command" "" '"$INSTDIR\inkism.exe" --open "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ReadRegStr $0 HKCU "Software\Classes\note\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\inkism.exe" --open "%1"'
    DeleteRegKey HKCU "Software\Classes\note"
  ${EndIf}
!macroend
