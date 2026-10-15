; Keep electron-builder's installer and uninstaller templates intact. Deeply
; nested runtime dependencies exceed MAX_PATH in both 7z-out and old-install
; when the inherited temporary path is long.
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
Var PaperclipTempRoot
Var PaperclipOriginalTemp
Var PaperclipOriginalTmp

Function PaperclipPrepareTemp
  ; Preserve stock behavior for an already-short native TEMP. The marker only
  ; restores process environment; it grants no staging or cleanup authority.
  ; Long TEMP always goes through private-directory creation below.
  StrLen $0 $TEMP
  ${If} $0 > 13
    Goto paperclip_temp_create
  ${EndIf}
  ReadEnvStr $PaperclipTempRoot "PAPERCLIP_NSIS_TEMP_ROOT"
  ${If} $PaperclipTempRoot == $TEMP
  ${AndIf} $PaperclipTempRoot != ""
    StrLen $0 $PaperclipTempRoot
    StrCpy $1 $PaperclipTempRoot 2 3
    ${If} $0 == 13
    ${AndIf} $1 == "pc"
      StrCpy $1 $PaperclipTempRoot "" 5
      IntOp $0 "0x$1" + 0
      IntFmt $0 "%08x" $0
      ${If} $0 == $1
        ReadEnvStr $PaperclipOriginalTemp "PAPERCLIP_NSIS_ORIGINAL_TEMP"
        ReadEnvStr $PaperclipOriginalTmp "PAPERCLIP_NSIS_ORIGINAL_TMP"
        Return
      ${EndIf}
    ${EndIf}
  ${EndIf}
  StrCpy $PaperclipTempRoot ""
  Return

  paperclip_temp_create:
  StrCpy $PaperclipTempRoot ""
  ; System itself must first load from the parent's native plugin directory.
  ; Reject extreme inputs before that first plugin can fail silently.
  ${If} $0 > 200
    Goto paperclip_temp_failed
  ${EndIf}

  ; Stay on the inherited temporary drive. UNC paths and unwritable drive
  ; roots fail explicitly instead of moving data onto a different drive.
  StrCpy $1 $TEMP 2 1
  ${If} $1 != ":\"
    Goto paperclip_temp_failed
  ${EndIf}
  StrCpy $2 $TEMP 3
  ReadEnvStr $PaperclipOriginalTemp "TEMP"
  ReadEnvStr $PaperclipOriginalTmp "TMP"

  System::Call 'kernel32::GetDriveTypeW(w "$2") i.r0'
  ${If} $0 != 3 ; DRIVE_FIXED
    Goto paperclip_temp_failed
  ${EndIf}
  System::Call 'kernel32::GetVolumeInformationW(w "$2", p 0, i 0, p 0, p 0, *i .r7, p 0, i 0) i.r0'
  IntOp $7 $7 & 8 ; FILE_PERSISTENT_ACLS
  ${If} $0 == 0
  ${OrIf} $7 == 0
    Goto paperclip_temp_failed
  ${EndIf}

  ; The parent can load System from its original plugin directory; only the
  ; child performs extraction. A protected DACL grants the owner, SYSTEM and
  ; administrators access, never other unprivileged users. Creation is atomic.
  System::Call 'advapi32::ConvertStringSecurityDescriptorToSecurityDescriptorW(w "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;OW)", i 1, *p .r3, p 0) i.r0'
  ${If} $0 == 0
    Goto paperclip_temp_failed
  ${EndIf}
  System::Call '*(i 12, p r3, i 0) p.r4'
  ${If} $4 == 0
    System::Call 'kernel32::LocalFree(p r3)'
    Goto paperclip_temp_failed
  ${EndIf}
  StrCpy $5 0
  paperclip_temp_retry:
    System::Call 'bcrypt::BCryptGenRandom(p 0, *i .r6, i 4, i 2) i.r0'
    ${If} $0 != 0
      Goto paperclip_temp_free
    ${EndIf}
    IntFmt $6 "%08x" $6
    StrCpy $PaperclipTempRoot "$2pc$6"
    System::Call 'kernel32::CreateDirectoryW(w "$PaperclipTempRoot", p r4) i.r0 ?e'
    Pop $7
    ${If} $0 == 0
      StrCpy $PaperclipTempRoot ""
      ${If} $7 == 183
        IntOp $5 $5 + 1
        ${If} $5 < 16
          Goto paperclip_temp_retry
        ${EndIf}
      ${EndIf}
    ${EndIf}
  paperclip_temp_free:
  System::Free $4
  System::Call 'kernel32::LocalFree(p r3)'
  ${If} $PaperclipTempRoot == ""
    Goto paperclip_temp_failed
  ${EndIf}

  System::Call 'kernel32::SetEnvironmentVariableW(w "PAPERCLIP_NSIS_ORIGINAL_TEMP", w "$PaperclipOriginalTemp") i.r0'
  ${If} $0 == 0
    Goto paperclip_temp_cleanup_failed
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariableW(w "PAPERCLIP_NSIS_ORIGINAL_TMP", w "$PaperclipOriginalTmp") i.r0'
  ${If} $0 == 0
    Goto paperclip_temp_cleanup_failed
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariableW(w "PAPERCLIP_NSIS_TEMP_ROOT", w "$PaperclipTempRoot") i.r0'
  ${If} $0 == 0
    Goto paperclip_temp_cleanup_failed
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w "$PaperclipTempRoot") i.r0'
  ${If} $0 == 0
    Goto paperclip_temp_cleanup_failed
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w "$PaperclipTempRoot") i.r0'
  ${If} $0 == 0
    Goto paperclip_temp_cleanup_failed
  ${EndIf}

  ; NSIS removes /D from $CMDLINE during native startup. Use the original
  ; Windows command line so /D (including spaces), /S and updater flags survive.
  System::Call 'kernel32::GetCommandLineW() p.r0'
  System::Call 'kernel32::lstrlenW(p r0) i.r1'
  ${If} $1 >= ${NSIS_MAX_STRLEN}
    Goto paperclip_temp_cleanup_failed
  ${EndIf}
  System::Call '*$0(&w${NSIS_MAX_STRLEN} .r1)'
  ClearErrors
  ExecWait '$1' $8
  ${If} ${Errors}
    StrCpy $8 1603
  ${EndIf}
  Goto paperclip_temp_cleanup

  paperclip_temp_cleanup_failed:
    StrCpy $8 1603
  paperclip_temp_cleanup:
    ; Only this parent owns a successfully created root. Never remove an
    ; inherited marker path or follow a replacement junction during cleanup.
    System::Call 'kernel32::GetFileAttributesW(w "$PaperclipTempRoot") i.r0'
    IntOp $0 $0 & 0x400
    ${If} $0 == 0
      RMDir /r "$PaperclipTempRoot"
    ${EndIf}
    SetErrorLevel $8
    Quit

  paperclip_temp_failed:
    DetailPrint "Cannot create a private short temporary directory on the TEMP drive."
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "无法在临时目录所在盘创建安全的短路径。请使用可写的本地短 TEMP/TMP 目录后重试。$\r$\nCannot create a private short temporary directory on the TEMP drive. Retry with writable, short local TEMP/TMP paths."
    SetErrorLevel 1603
    Quit
FunctionEnd

!macro preInit
  Call PaperclipPrepareTemp
!macroend

!macro customInstall
  ; Keep short TEMP until the legacy uninstaller has finished. Restore it
  ; before electron-builder's StartApp so the application never inherits a
  ; directory that the waiting parent will remove.
  ${If} $PaperclipTempRoot != ""
    System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w "$PaperclipOriginalTemp")'
    System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w "$PaperclipOriginalTmp")'
    System::Call 'kernel32::SetEnvironmentVariableW(w "PAPERCLIP_NSIS_TEMP_ROOT", p 0)'
    System::Call 'kernel32::SetEnvironmentVariableW(w "PAPERCLIP_NSIS_ORIGINAL_TEMP", p 0)'
    System::Call 'kernel32::SetEnvironmentVariableW(w "PAPERCLIP_NSIS_ORIGINAL_TMP", p 0)'
  ${EndIf}
!macroend
!endif
