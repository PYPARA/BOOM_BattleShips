#!/bin/sh
# Creates an Aha 3D Workshop project (Three.js), names it, sets its triangle budget, opens the
# modeling chat, attaches two concept images and sends a brief. Prints the new project hash.
# Usage: aha-new-model.sh <project name> <triangle budget> <image1> <image2> <message>
set -e
A="node $(dirname "$0")/aha-cdp.mjs"
NAME="$1"; BUDGET="$2"; IMG1="$3"; IMG2="$4"; MSG="$5"
$A eval 'location.hash="#/model3d"; true' >/dev/null; sleep 2
$A eval '(()=>{[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="新建 3D 工程").click(); return true})()' >/dev/null; sleep 3
$A eval '(()=>{[...document.querySelectorAll("button,[role=tab]")].find(e=>e.textContent.trim()==="属性").click(); return true})()' >/dev/null
# The name field has no type attribute, so match on the property, not [type=text].
for i in 1 2 3 4 5 6 7 8 9 10; do
  $A eval '!![...document.querySelectorAll("input")].find(e=>e.type==="text"&&e.value==="未命名 3D 工程")' | grep -q true && break; sleep 0.5
done
$A eval '(()=>{const i=[...document.querySelectorAll("input")].find(e=>e.type==="text"&&e.value==="未命名 3D 工程"); i.focus(); i.select(); return true})()' >/dev/null
$A type "$NAME" >/dev/null; $A key Enter >/dev/null
$A eval '(()=>{const i=document.querySelector("input[type=number]"); i.focus(); i.select(); return true})()' >/dev/null
$A type "$BUDGET" >/dev/null; $A key Tab >/dev/null; sleep 0.5
$A eval '(()=>{[...document.querySelectorAll("button,[role=tab]")].find(e=>e.textContent.trim()==="AI 助手").click(); return true})()' >/dev/null; sleep 0.6
$A eval '(()=>{[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="开始建模对话").click(); return true})()' >/dev/null; sleep 2.5
$A eval '(()=>{document.querySelector("button[aria-label=\"Composer extras\"]").click(); return true})()' >/dev/null; sleep 0.7
$A files 'input[type=file]' "$IMG1" "$IMG2" >/dev/null; sleep 1
$A key Escape >/dev/null; sleep 0.4
$A eval '(()=>{document.querySelector("[contenteditable=true]").focus(); return true})()' >/dev/null
$A type "$MSG" >/dev/null; sleep 0.5
$A eval '(()=>{const b=document.querySelector("button[aria-label=\"发送消息\"]"); const ok=!b.disabled; b.click(); return ok})()'
$A eval 'location.hash'
