; DukaanDesk Pro NSIS additions (electron-builder nsis.include). UNTESTED ON WINDOWS.
; One installer, three choices on a page after the folder page:
;   Main PC          - sells (Till 1) and keeps the shop data (PostgreSQL + server service)
;   Main PC, no till - keeps the data only (server-only; Till 1 off)
;   Till PC          - sells only; connects to the main PC over the network (no database)
!include nsDialogs.nsh
!include LogicLib.nsh

Var DDKind      ; main-till | server-only | till
Var DDRadio1
Var DDRadio2
Var DDRadio3

!macro customPageAfterChangeDir
  Page custom DDKindPage DDKindLeave
!macroend

Function DDKindPage
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 12u "Install on this PC as"
  ${NSD_CreateRadioButton} 0 20u 100% 12u "Main PC (sells and keeps the shop data)"
  Pop $DDRadio1
  ${NSD_CreateRadioButton} 0 36u 100% 12u "Main PC, no till (keeps the shop data only)"
  Pop $DDRadio2
  ${NSD_CreateRadioButton} 0 52u 100% 12u "Till PC (sells; connects to the main PC)"
  Pop $DDRadio3
  ${NSD_Check} $DDRadio1
  nsDialogs::Show
FunctionEnd

Function DDKindLeave
  StrCpy $DDKind "main-till"
  ${NSD_GetState} $DDRadio2 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $DDKind "server-only"
  ${EndIf}
  ${NSD_GetState} $DDRadio3 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $DDKind "till"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${If} $DDKind == "till"
    FileOpen $0 "$INSTDIR\till-only.flag" w
    FileWrite $0 "DukaanDesk Pro till PC"
    FileClose $0
    Delete "$INSTDIR\main-pc.flag"
  ${Else}
    Delete "$INSTDIR\till-only.flag"
    FileOpen $0 "$INSTDIR\main-pc.flag" w
    FileWrite $0 "$DDKind"
    FileClose $0
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\win\main-pc-setup.ps1" -AppDir "$INSTDIR" -Mode $DDKind'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "DukaanDesk Pro could not set up the shop database ($0). See %ProgramData%\dukaandeskpro\logs."
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${If} ${FileExists} "$INSTDIR\main-pc.flag"
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\win\main-pc-remove.ps1" -AppDir "$INSTDIR"'
    Pop $0
  ${EndIf}
  Delete "$INSTDIR\till-only.flag"
  Delete "$INSTDIR\main-pc.flag"
!macroend
