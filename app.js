"use strict";

const STORAGE_KEY="quadro_deducao_app_v24";
const PERSIST_DELAY=180;

const difficultyConfig={
  basico:{label:"Básico",level:"pequeno"},
  medio:{label:"Médio",level:"pequeno"},
  muitodificil:{label:"Muito difícil",level:"grande"},
  impossivel:{label:"Impossível",level:"grande"}
};

const config={
  pequeno:{
    label:"Básico / Médio",
    big:false,
    n:3,
    titles:["Suspeitos","Armas","Locais"],
    prefixes:["SUSPEITO","ARMA","LOCAL"]
  },
  grande:{
    label:"Muito difícil / Impossível",
    big:true,
    n:4,
    titles:["Suspeitos","Armas","Motivos","Locais"],
    prefixes:["SUSPEITO","ARMA","MOTIVO","LOCAL"]
  }
};

const els={
  layout:document.getElementById("resolverLayout"),
  appTabs:[...document.querySelectorAll(".app-tab")],
  levelTabs:[...document.querySelectorAll(".level-tab")],
  screens:{
    resolver:document.getElementById("screen-resolver-inner"),
    saved:document.getElementById("screen-saved-inner")
  },
  menuToggle:document.getElementById("menuToggle"),
  levelNote:document.getElementById("levelNote"),
  difficultySelect:document.getElementById("difficultySelect"),
  caseName:document.getElementById("caseName"),
  bookName:document.getElementById("bookName"),
  caseNumber:document.getElementById("caseNumber"),
  caseStatus:document.getElementById("caseStatus"),
  caseNotes:document.getElementById("caseNotes"),
  notesDetails:document.getElementById("notesDetails"),
  saveCase:document.getElementById("saveCase"),
  undoAction:document.getElementById("undoAction"),
  newCase:document.getElementById("newCase"),
  clearCase:document.getElementById("clearCase"),
  printCase:document.getElementById("printCase"),
  saveStatus:document.getElementById("saveStatus"),
  editor:document.getElementById("editor"),
  board:document.getElementById("board"),
  boardCaption:document.getElementById("boardCaption"),
  boardScroll:document.getElementById("boardScroll"),
  scrollHint:document.getElementById("scrollHint"),
  choicePanel:document.getElementById("choicePanel"),
  choiceToggle:document.getElementById("choiceToggle"),
  choiceGroups:document.getElementById("choiceGroups"),
  savedList:document.getElementById("savedCasesList"),
  savedCount:document.getElementById("savedCount"),
  exportBackup:document.getElementById("exportBackup"),
  importBackup:document.getElementById("importBackup"),
  backupFile:document.getElementById("backupFile"),
  printSheet:document.getElementById("printSheet"),
  printCaseTitle:document.getElementById("printCaseTitle"),
  printMeta:document.getElementById("printMeta"),
  printDifficulty:document.getElementById("printDifficulty"),
  printBoardArea:document.getElementById("printBoardArea"),
  printChoices:document.getElementById("printChoices")
};

let currentScreen="resolver";
let level="pequeno";
let difficultyByLevel={
  pequeno:"basico",
  grande:"muitodificil"
};
let difficulty=difficultyByLevel[level];
let workspaces={
  pequeno:makeState("pequeno"),
  grande:makeState("grande")
};
let savedCases=[];
let currentCaseId=null;
let choicePanelCollapsed=false;
let draftDirty=false;
let undoStack=[];
let persistTimer=null;

const UNDO_LIMIT=100;

function normalizeLevel(value){
  if(value==="basico" || value==="medio" || value==="pequeno") return "pequeno";
  if(value==="muitodificil" || value==="impossivel" || value==="grande") return "grande";
  return "pequeno";
}

function normalizeDifficulty(value,levelKey){
  if(difficultyConfig[value] && difficultyConfig[value].level===levelKey) return value;
  return levelKey==="grande" ? "muitodificil" : "basico";
}

function difficultiesForLevel(levelKey){
  return levelKey==="grande"
    ? ["muitodificil","impossivel"]
    : ["basico","medio"];
}

function renderDifficultySelect(){
  const options=difficultiesForLevel(level);
  difficulty=normalizeDifficulty(difficultyByLevel[level],level);
  difficultyByLevel[level]=difficulty;

  els.difficultySelect.innerHTML="";
  options.forEach(key=>{
    const option=document.createElement("option");
    option.value=key;
    option.textContent=difficultyConfig[key].label;
    option.selected=key===difficulty;
    els.difficultySelect.appendChild(option);
  });
}

function normalizeCaseStatus(value){
  return value==="resolvido" ? "resolvido" : "andamento";
}

function caseStatusLabel(value){
  return normalizeCaseStatus(value)==="resolvido" ? "Resolvido" : "Em andamento";
}

function markDirty(){
  draftDirty=true;
  schedulePersist();
}

function clearDirty(){
  draftDirty=false;
}

function updateUndoButton(){
  els.undoAction.disabled=undoStack.length===0;
}

function clearUndo(){
  undoStack=[];
  updateUndoButton();
}

function pushUndo(sourceState){
  const s=sourceState || state();

  undoStack.push({
    level,
    marks:deepClone(s.marks),
    solution:deepClone(s.solution)
  });

  if(undoStack.length>UNDO_LIMIT) undoStack.shift();
  updateUndoButton();
}

function undoLastAction(){
  const previous=undoStack.pop();
  if(!previous) return;

  if(previous.level!==level){
    clearUndo();
    return;
  }

  const s=state();
  s.marks=deepClone(previous.marks);
  s.solution=deepClone(previous.solution);

  renderBoard();
  updateUndoButton();
  markDirty();
  flash("Última marcação desfeita.");
}

function solutionDefinitions(levelKey){
  return levelKey==="grande"
    ? [
        {key:"suspeito",title:"Suspeito",catIndex:0},
        {key:"arma",title:"Arma",catIndex:1},
        {key:"local",title:"Local",catIndex:3},
        {key:"motivo",title:"Motivo",catIndex:2}
      ]
    : [
        {key:"suspeito",title:"Suspeito",catIndex:0},
        {key:"arma",title:"Arma",catIndex:1},
        {key:"local",title:"Local",catIndex:2}
      ];
}

function makeState(levelKey){
  const c=config[levelKey];
  const solution={};
  solutionDefinitions(levelKey).forEach(def=>solution[def.key]=null);

  return {
    n:c.n,
    cats:c.titles.map(title=>({title,items:Array(c.n).fill("")})),
    marks:{},
    solution,
    editorCollapsed:Object.fromEntries(c.titles.map((_,i)=>[i,true]))
  };
}

function validMarkKeys(levelKey){
  const c=config[levelKey];
  const prefixes=c.big
    ? ["arm-sus","arm-mot","arm-loc","loc-sus","loc-mot","mot-sus"]
    : ["a-s","a-l","l-s"];

  const keys=new Set();
  prefixes.forEach(prefix=>{
    for(let row=0;row<c.n;row++){
      for(let col=0;col<c.n;col++){
        keys.add(`${prefix}|${row}|${col}`);
      }
    }
  });
  return keys;
}

const validMarksByLevel={
  pequeno:validMarkKeys("pequeno"),
  grande:validMarkKeys("grande")
};

function normalizeState(levelKey,raw){
  const c=config[levelKey];
  const clean=makeState(levelKey);
  const source=raw && typeof raw==="object" ? raw : {};

  clean.cats=c.titles.map((title,catIndex)=>{
    const old=source.cats?.[catIndex];
    const items=Array.from({length:c.n},(_,itemIndex)=>{
      const value=String(old?.items?.[itemIndex] ?? "").trim().toUpperCase();
      const oldDefault=`${c.prefixes[catIndex]} ${itemIndex+1}`;
      return value===oldDefault ? "" : value;
    });
    return {title,items};
  });

  if(source.marks && typeof source.marks==="object"){
    for(const [key,value] of Object.entries(source.marks)){
      if(validMarksByLevel[levelKey].has(key) && (value===1 || value===2)){
        clean.marks[key]=value;
      }
    }
  }

  if(source.editorCollapsed && typeof source.editorCollapsed==="object"){
    c.titles.forEach((_,index)=>{
      clean.editorCollapsed[index]=source.editorCollapsed[index]!==false;
    });
  }

  const defs=solutionDefinitions(levelKey);
  defs.forEach(def=>{
    const selected=source.solution?.[def.key];
    if(
      Number.isInteger(selected) &&
      selected>=0 &&
      selected<c.n &&
      clean.cats[def.catIndex].items[selected]
    ){
      clean.solution[def.key]=selected;
    }
  });

  return clean;
}

function normalizeSavedCases(raw){
  if(!Array.isArray(raw)) return [];

  const usedIds=new Set();
  const clean=[];

  raw.forEach((item,index)=>{
    if(!item || typeof item!=="object") return;

    const itemLevel=normalizeLevel(item.level);
    let id=typeof item.id==="string" && item.id.trim()
      ? item.id.trim()
      : `legacy-${index}-${Date.now()}`;

    while(usedIds.has(id)) id=`${id}-${index}`;
    usedIds.add(id);

    const date=new Date(item.updatedAt);
    clean.push({
      id,
      name:String(item.name || "Caso sem nome").trim() || "Caso sem nome",
      bookName:String(item.bookName || "").trim(),
      caseNumber:String(item.caseNumber || "").trim(),
      status:normalizeCaseStatus(item.status),
      notes:String(item.notes || ""),
      level:itemLevel,
      difficulty:normalizeDifficulty(item.difficulty,itemLevel),
      state:normalizeState(itemLevel,item.state),
      updatedAt:Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
    });
  });

  return clean;
}

function state(){
  if(!workspaces[level]){
    workspaces[level]=makeState(level);
  }
  return workspaces[level];
}

function deepClone(value){
  return JSON.parse(JSON.stringify(value));
}

function storagePayload(){
  return {
    currentScreen,
    level,
    difficulty,
    difficultyByLevel,
    saves:workspaces,
    savedCases,
    currentCaseId,
    caseName:els.caseName.value || "",
    bookName:els.bookName.value || "",
    caseNumber:els.caseNumber.value || "",
    caseStatus:normalizeCaseStatus(els.caseStatus.value),
    caseNotes:els.caseNotes.value || "",
    notesDetailsOpen:els.notesDetails.open,
    draftDirty,
    menuHidden:els.layout.classList.contains("menu-hidden"),
    choicePanelCollapsed
  };
}

function persistNow(){
  clearTimeout(persistTimer);
  persistTimer=null;

  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify(storagePayload()));
  }catch(error){
    console.warn("Não foi possível salvar os dados do app.",error);
    flash("Não foi possível salvar no navegador.");
  }
}

function schedulePersist(){
  clearTimeout(persistTimer);
  persistTimer=setTimeout(persistNow,PERSIST_DELAY);
}

function loadPersisted(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw) return;

    const data=JSON.parse(raw);
    currentScreen=data.currentScreen==="saved" ? "saved" : "resolver";
    level=normalizeLevel(data.level);

    difficultyByLevel={
      pequeno:normalizeDifficulty(
        data.difficultyByLevel?.pequeno ||
        (level==="pequeno" ? data.difficulty : null),
        "pequeno"
      ),
      grande:normalizeDifficulty(
        data.difficultyByLevel?.grande ||
        (level==="grande" ? data.difficulty : null),
        "grande"
      )
    };
    difficulty=difficultyByLevel[level];

    if(data.saves && typeof data.saves==="object"){
      const small=data.saves.pequeno || data.saves.basico || data.saves.medio;
      const big=data.saves.grande || data.saves.muitodificil || data.saves.impossivel;
      workspaces.pequeno=normalizeState("pequeno",small);
      workspaces.grande=normalizeState("grande",big);
    }

    savedCases=normalizeSavedCases(data.savedCases);

    if(typeof data.caseName==="string") els.caseName.value=data.caseName;
    if(typeof data.bookName==="string") els.bookName.value=data.bookName;
    if(typeof data.caseNumber==="string") els.caseNumber.value=data.caseNumber;
    els.caseStatus.value=normalizeCaseStatus(data.caseStatus);
    if(typeof data.caseNotes==="string") els.caseNotes.value=data.caseNotes;
    els.notesDetails.open=Boolean(
      typeof data.notesDetailsOpen==="boolean"
        ? data.notesDetailsOpen
        : data.notesOpen
    );

    draftDirty=Boolean(data.draftDirty);
    choicePanelCollapsed=Boolean(data.choicePanelCollapsed);

    if(data.menuHidden) els.layout.classList.add("menu-hidden");

    const candidateId=typeof data.currentCaseId==="string" ? data.currentCaseId : null;
    const matchingCase=savedCases.find(item=>item.id===candidateId && item.level===level);
    currentCaseId=matchingCase ? candidateId : null;
  }catch(error){
    console.warn("Dados antigos inválidos foram ignorados.",error);
    workspaces={
      pequeno:makeState("pequeno"),
      grande:makeState("grande")
    };
    savedCases=[];
    currentCaseId=null;
    draftDirty=false;
  }
}

function flash(text){
  els.saveStatus.textContent=text;
  clearTimeout(flash.timer);
  flash.timer=setTimeout(()=>{
    if(els.saveStatus.textContent===text) els.saveStatus.textContent="";
  },2200);
}

function formatDate(iso){
  const date=new Date(iso);
  if(Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR",{
    day:"2-digit",
    month:"2-digit",
    year:"numeric",
    hour:"2-digit",
    minute:"2-digit"
  });
}

function createId(){
  if(window.crypto?.randomUUID) return crypto.randomUUID();
  return `caso-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function workspaceHasData(workspace){
  if(!workspace) return false;
  const hasNames=workspace.cats?.some(cat=>cat.items?.some(item=>String(item || "").trim()));
  const hasMarks=Object.keys(workspace.marks || {}).length>0;
  const hasChoices=Object.values(workspace.solution || {}).some(Number.isInteger);
  return Boolean(hasNames || hasMarks || hasChoices);
}

function hasDraftData(){
  return Boolean(
    (els.caseName.value || "").trim() ||
    (els.bookName.value || "").trim() ||
    (els.caseNumber.value || "").trim() ||
    (els.caseNotes.value || "").trim() ||
    els.caseStatus.value==="resolvido" ||
    workspaceHasData(workspaces.pequeno) ||
    workspaceHasData(workspaces.grande)
  );
}

function resetDraft(){
  workspaces={
    pequeno:makeState("pequeno"),
    grande:makeState("grande")
  };

  currentCaseId=null;
  els.caseName.value="";
  els.bookName.value="";
  els.caseNumber.value="";
  els.caseStatus.value="andamento";
  els.caseNotes.value="";
  els.notesDetails.open=false;
  clearUndo();
  clearDirty();
}

function setScreen(name){
  currentScreen=name==="saved" ? "saved" : "resolver";

  els.appTabs.forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.screen===currentScreen);
  });

  Object.entries(els.screens).forEach(([key,screen])=>{
    const active=key===currentScreen;
    screen.classList.toggle("active",active);
    screen.hidden=!active;
  });

  els.layout.classList.toggle("saved-mode",currentScreen==="saved");

  els.choicePanel.style.display=currentScreen==="resolver" ? "" : "none";
  if(currentScreen==="resolver") syncChoicePanel();

  requestAnimationFrame(updateScrollHint);
  schedulePersist();
}

function syncMenuArrow(){
  const hidden=els.layout.classList.contains("menu-hidden");
  els.menuToggle.textContent=hidden ? "▶" : "◀";
  els.menuToggle.setAttribute("aria-label",hidden ? "Abrir menu" : "Fechar menu");
  els.menuToggle.title=hidden ? "Abrir menu" : "Fechar menu";
}

function toggleMenu(){
  els.layout.classList.toggle("menu-hidden");
  syncMenuArrow();
  schedulePersist();
  requestAnimationFrame(updateScrollHint);
}

function syncChoicePanel(){
  els.choicePanel.classList.toggle("collapsed",choicePanelCollapsed);
  els.choiceToggle.textContent=choicePanelCollapsed ? "◀" : "▶";
  els.choiceToggle.setAttribute(
    "aria-label",
    choicePanelCollapsed ? "Abrir escolhas" : "Fechar escolhas"
  );
  els.choiceToggle.title=choicePanelCollapsed ? "Abrir escolhas" : "Fechar escolhas";
}

function toggleChoicePanel(){
  choicePanelCollapsed=!choicePanelCollapsed;
  syncChoicePanel();
  schedulePersist();
}

function setBoardName(el,text){
  const value=String(text || "");
  el.textContent=value;
  el.title=value;
  el.classList.add("board-name");

  if(value.length>34) el.classList.add("very-long");
  else if(value.length>25) el.classList.add("long");
  else if(value.length>16) el.classList.add("medium");
}

function categoryColors(){
  return config[level].big
    ? ["var(--red)","var(--red)","var(--blue)","var(--green)"]
    : ["var(--red)","var(--red)","var(--green)"];
}

function renderEditor(){
  const s=state();
  const c=config[level];
  const colors=categoryColors();
  els.editor.innerHTML="";

  s.cats.forEach((cat,catIndex)=>{
    const card=document.createElement("section");
    card.className="group-editor";
    if(s.editorCollapsed[catIndex]) card.classList.add("collapsed");

    const summary=document.createElement("button");
    summary.type="button";
    summary.className="group-summary";
    summary.setAttribute("aria-expanded",String(!s.editorCollapsed[catIndex]));

    const left=document.createElement("span");
    left.className="left";

    const dot=document.createElement("span");
    dot.className="dot";
    dot.style.background=colors[catIndex];

    const label=document.createElement("span");
    label.textContent=cat.title;

    const chevron=document.createElement("span");
    chevron.className="chevron";
    chevron.textContent="▾";

    left.append(dot,label);
    summary.append(left,chevron);

    summary.addEventListener("click",()=>{
      s.editorCollapsed[catIndex]=!s.editorCollapsed[catIndex];
      renderEditor();
      schedulePersist();
    });

    const content=document.createElement("div");
    content.className="group-content";

    const items=document.createElement("div");
    items.className="group-items";

    cat.items.forEach((value,itemIndex)=>{
      const input=document.createElement("input");
      input.type="text";
      input.value=value;
      input.autocomplete="off";
      input.placeholder=`EX.: ${c.prefixes[catIndex]} ${itemIndex+1}`;
      input.setAttribute("aria-label",`${cat.title} ${itemIndex+1}`);

      input.addEventListener("input",event=>{
        const upper=event.target.value.toUpperCase();
        event.target.value=upper;
        s.cats[catIndex].items[itemIndex]=upper;

        solutionDefinitions(level).forEach(def=>{
          if(
            def.catIndex===catIndex &&
            s.solution[def.key]===itemIndex &&
            !upper.trim()
          ){
            s.solution[def.key]=null;
          }
        });

        renderBoard();
        markDirty();
      });

      items.appendChild(input);
    });

    content.appendChild(items);
    card.append(summary,content);
    els.editor.appendChild(card);
  });
}

function markLabel(value){
  if(value===1) return "impossível";
  if(value===2) return "confirmado";
  return "não marcado";
}

function paintCell(cell,value){
  cell.classList.remove("no","yes");
  cell.textContent="";

  if(value===1){
    cell.classList.add("no");
    cell.textContent="✕";
  }else if(value===2){
    cell.classList.add("yes");
    cell.textContent="✓";
  }

  cell.setAttribute("aria-label",`Célula: ${markLabel(value)}. Clique para alterar.`);
}

function createCell(key){
  const cell=document.createElement("button");
  cell.type="button";
  cell.className="cell";

  paintCell(cell,state().marks[key] || 0);

  cell.addEventListener("click",()=>{
    const s=state();
    pushUndo(s);

    const current=s.marks[key] || 0;
    const next=current===0 ? 1 : current===1 ? 2 : 0;

    if(next===0) delete s.marks[key];
    else s.marks[key]=next;

    paintCell(cell,next);
    markDirty();
  });

  return cell;
}

function createHeader(className,title,items){
  const header=document.createElement("div");
  header.className=className;

  const titleEl=document.createElement("div");
  titleEl.className="title";
  titleEl.textContent=title;

  const names=document.createElement("div");
  names.className="names";

  items.forEach(item=>{
    const name=document.createElement("div");
    name.className="name";
    setBoardName(name,item);
    names.appendChild(name);
  });

  header.append(titleEl,names);
  return header;
}

function createSide(className,title,items){
  const side=document.createElement("div");
  side.className=className;

  const label=document.createElement("div");
  label.className="label";
  label.textContent=title;

  const names=document.createElement("div");
  names.className="names";

  items.forEach(item=>{
    const name=document.createElement("div");
    name.className="name";
    setBoardName(name,item);
    names.appendChild(name);
  });

  side.append(label,names);
  return side;
}

function appendMatrix(root,className,keyPrefix,n){
  const matrix=document.createElement("div");
  matrix.className=className;

  for(let row=0;row<n;row++){
    for(let col=0;col<n;col++){
      matrix.appendChild(createCell(`${keyPrefix}|${row}|${col}`));
    }
  }

  root.appendChild(matrix);
}

function renderSmall(){
  const s=state();
  const root=document.createElement("div");
  root.className="small-board";

  root.appendChild(createHeader("small-head sus",s.cats[0].title,s.cats[0].items));
  root.appendChild(createHeader("small-head loc",s.cats[2].title,s.cats[2].items));
  root.appendChild(createSide("small-side weap",s.cats[1].title,s.cats[1].items));
  root.appendChild(createSide("small-side loc",s.cats[2].title,s.cats[2].items));

  appendMatrix(root,"small-matrix red","a-s",3);
  appendMatrix(root,"small-matrix green top","a-l",3);
  appendMatrix(root,"small-matrix green bottom","l-s",3);

  els.board.replaceChildren(root);
}

function renderBig(){
  const s=state();
  const root=document.createElement("div");
  root.className="big-wrap";

  root.appendChild(createHeader("big-head sus",s.cats[0].title,s.cats[0].items));
  root.appendChild(createHeader("big-head mot",s.cats[2].title,s.cats[2].items));
  root.appendChild(createHeader("big-head loc",s.cats[3].title,s.cats[3].items));

  root.appendChild(createSide("big-side arm",s.cats[1].title,s.cats[1].items));
  root.appendChild(createSide("big-side loc",s.cats[3].title,s.cats[3].items));
  root.appendChild(createSide("big-side mot",s.cats[2].title,s.cats[2].items));

  appendMatrix(root,"matrix red","arm-sus",4);
  appendMatrix(root,"matrix blue top","arm-mot",4);
  appendMatrix(root,"matrix green top","arm-loc",4);
  appendMatrix(root,"matrix green mid","loc-sus",4);
  appendMatrix(root,"matrix blue mid","loc-mot",4);
  appendMatrix(root,"matrix blue bottom","mot-sus",4);

  els.board.replaceChildren(root);
}

function renderChoicePanel(){
  const s=state();
  els.choiceGroups.innerHTML="";

  solutionDefinitions(level).forEach(def=>{
    const group=document.createElement("section");
    group.className="choice-group";

    const head=document.createElement("div");
    head.className="choice-group-head";
    head.textContent=def.title;

    const options=document.createElement("div");
    options.className="choice-options";

    s.cats[def.catIndex].items.forEach((rawValue,index)=>{
      const value=String(rawValue || "").trim();

      const option=document.createElement("label");
      option.className="choice-option";
      if(!value) option.classList.add("empty");
      if(s.solution[def.key]===index) option.classList.add("selected");

      const check=document.createElement("input");
      check.type="checkbox";
      check.value=String(index);
      check.checked=s.solution[def.key]===index;
      check.disabled=!value;
      check.setAttribute("aria-label",value || `${def.title} ${index+1}`);

      check.addEventListener("change",()=>{
        pushUndo(s);

        if(check.checked){
          s.solution[def.key]=index;
        }else if(s.solution[def.key]===index){
          s.solution[def.key]=null;
        }

        renderChoicePanel();
        markDirty();
      });

      const text=document.createElement("span");
      text.textContent=value || `EX.: ${def.title.toUpperCase()} ${index+1}`;

      option.append(check,text);
      options.appendChild(option);
    });

    group.append(head,options);
    els.choiceGroups.appendChild(group);
  });
}

function updateScrollHint(){
  const overflow=els.boardScroll.scrollWidth > els.boardScroll.clientWidth + 4;
  els.scrollHint.classList.toggle("visible",overflow);
}

function resetBoardScroll(){
  els.boardScroll.scrollLeft=0;
  els.boardScroll.scrollTop=0;
}

function renderBoard(){
  els.boardCaption.textContent=config[level].label;
  els.levelNote.textContent="Quadro de dedução";

  if(config[level].big) renderBig();
  else renderSmall();

  renderChoicePanel();
  requestAnimationFrame(updateScrollHint);
}

function refreshLevelTabs(){
  els.levelTabs.forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.level===level);
  });
}

function switchLevel(nextLevel){
  const normalized=normalizeLevel(nextLevel);
  if(normalized===level) return;

  /* Um caso salvo nunca pode ser sobrescrito depois de trocar o tipo de quadro. */
  if(currentCaseId){
    currentCaseId=null;
    flash("Tipo de quadro alterado. Ao salvar, será criado um novo caso.");
  }

  level=normalized;
  difficulty=normalizeDifficulty(difficultyByLevel[level],level);
  difficultyByLevel[level]=difficulty;
  workspaces[level]=normalizeState(level,workspaces[level]);
  clearUndo();

  refreshLevelTabs();
  renderDifficultySelect();
  renderEditor();
  renderBoard();
  resetBoardScroll();
  schedulePersist();
}

function saveCurrentCase(){
  const name=(els.caseName.value || "").trim() || `Caso ${savedCases.length+1}`;
  els.caseName.value=name;

  const existingIndex=currentCaseId
    ? savedCases.findIndex(item=>item.id===currentCaseId && item.level===level)
    : -1;

  const id=existingIndex>=0 ? currentCaseId : createId();

  const snapshot={
    id,
    name,
    bookName:(els.bookName.value || "").trim(),
    caseNumber:(els.caseNumber.value || "").trim(),
    status:normalizeCaseStatus(els.caseStatus.value),
    notes:els.caseNotes.value || "",
    level,
    difficulty,
    state:deepClone(state()),
    updatedAt:new Date().toISOString()
  };

  if(existingIndex>=0) savedCases[existingIndex]=snapshot;
  else savedCases.push(snapshot);

  currentCaseId=id;
  difficultyByLevel[level]=difficulty;
  clearDirty();
  persistNow();
  renderSavedCases();
  flash(existingIndex>=0 ? "Caso atualizado." : "Caso salvo.");
}

function newCase(){
  if(hasDraftData() && !confirm("Criar um novo caso? O conteúdo atual não salvo será limpo.")){
    return;
  }

  resetDraft();
  renderEditor();
  renderBoard();
  resetBoardScroll();
  persistNow();
  flash("Novo caso.");
}

function clearCurrentCase(){
  if(!hasDraftData()) return;

  if(!confirm("Limpar todos os campos, escolhas e marcações do caso atual?")){
    return;
  }

  resetDraft();
  renderEditor();
  renderBoard();
  resetBoardScroll();
  persistNow();
  flash("Tudo foi limpo.");
}

function openSavedCase(item){
  if(
    draftDirty &&
    !confirm("Abrir este caso? As alterações não salvas do caso atual serão perdidas.")
  ){
    return;
  }

  level=item.level;
  difficulty=normalizeDifficulty(item.difficulty,level);
  difficultyByLevel[level]=difficulty;

  /* Ao abrir um caso, não carregamos rascunhos de outro tipo de quadro. */
  workspaces={
    pequeno:makeState("pequeno"),
    grande:makeState("grande")
  };
  workspaces[level]=normalizeState(level,item.state);

  currentCaseId=item.id;
  els.caseName.value=item.name;
  els.bookName.value=item.bookName || "";
  els.caseNumber.value=item.caseNumber || "";
  els.caseStatus.value=normalizeCaseStatus(item.status);
  els.caseNotes.value=item.notes || "";
  els.notesDetails.open=Boolean(item.notes);
  clearUndo();
  clearDirty();

  refreshLevelTabs();
  renderDifficultySelect();
  renderEditor();
  renderBoard();
  resetBoardScroll();
  setScreen("resolver");
  persistNow();
  flash("Caso aberto.");
}

function deleteSavedCase(item){
  if(!confirm(`Excluir "${item.name}"?`)) return;

  savedCases=savedCases.filter(saved=>saved.id!==item.id);
  if(currentCaseId===item.id) currentCaseId=null;

  renderSavedCases();
  persistNow();
}


function buildPrintSheet(){
  const s=state();
  const caseTitle=(els.caseName.value || "").trim() || "Caso sem nome";
  const meta=[];

  const book=(els.bookName.value || "").trim();
  const number=(els.caseNumber.value || "").trim();

  if(book) meta.push(book);
  if(number) meta.push(`Caso ${number}`);
  meta.push(caseStatusLabel(els.caseStatus.value));

  els.printCaseTitle.textContent=caseTitle;
  els.printDifficulty.textContent=difficultyConfig[difficulty].label;

  els.printMeta.replaceChildren();
  meta.forEach(value=>{
    const span=document.createElement("span");
    span.textContent=value;
    els.printMeta.appendChild(span);
  });

  const boardClone=els.board.firstElementChild
    ? els.board.firstElementChild.cloneNode(true)
    : null;

  els.printBoardArea.replaceChildren();
  els.printBoardArea.className=`print-board-area ${config[level].big ? "big-print" : "small-print"}`;

  if(boardClone){
    boardClone.querySelectorAll("button").forEach(button=>{
      button.tabIndex=-1;
      button.setAttribute("aria-hidden","true");
    });
    els.printBoardArea.appendChild(boardClone);
  }

  els.printChoices.replaceChildren();
  els.printChoices.className=`print-choices ${config[level].big ? "four" : "three"}`;

  solutionDefinitions(level).forEach(def=>{
    const group=document.createElement("section");
    group.className="print-choice-group";

    const title=document.createElement("div");
    title.className="print-choice-title";
    title.textContent=def.title;

    const options=document.createElement("div");
    options.className="print-choice-options";

    s.cats[def.catIndex].items.forEach((rawValue,index)=>{
      const value=String(rawValue || "").trim() || "—";
      const selected=s.solution[def.key]===index;

      const option=document.createElement("div");
      option.className=`print-choice-option${selected ? " selected" : ""}`;

      const box=document.createElement("span");
      box.className="print-choice-box";
      box.textContent=selected ? "☑" : "☐";

      const text=document.createElement("span");
      text.textContent=value;

      option.append(box,text);
      options.appendChild(option);
    });

    group.append(title,options);
    els.printChoices.appendChild(group);
  });

  els.printSheet.setAttribute("aria-hidden","false");
}

function printCurrentCase(){
  buildPrintSheet();

  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      window.print();
    });
  });
}

function cleanupPrintSheet(){
  els.printSheet.setAttribute("aria-hidden","true");
}

function exportBackup(){
  const backup={
    app:"quadro-deducao",
    version:1,
    exportedAt:new Date().toISOString(),
    savedCases:deepClone(savedCases),
    draft:{
      level,
      difficulty,
      difficultyByLevel:deepClone(difficultyByLevel),
      workspaces:deepClone(workspaces),
      caseName:els.caseName.value || "",
      bookName:els.bookName.value || "",
      caseNumber:els.caseNumber.value || "",
      caseStatus:normalizeCaseStatus(els.caseStatus.value),
      caseNotes:els.caseNotes.value || ""
    }
  };

  const blob=new Blob(
    [JSON.stringify(backup,null,2)],
    {type:"application/json;charset=utf-8"}
  );

  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  const date=new Date().toISOString().slice(0,10);

  link.href=url;
  link.download=`quadro-deducao-backup-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(()=>URL.revokeObjectURL(url),0);
  flash("Backup exportado.");
}

function importBackupFile(file){
  if(!file) return;

  const reader=new FileReader();

  reader.onload=()=>{
    try{
      const backup=JSON.parse(String(reader.result || ""));

      if(!backup || backup.app!=="quadro-deducao" || !Array.isArray(backup.savedCases)){
        throw new Error("Formato de backup inválido.");
      }

      if(!confirm("Restaurar este backup? Os casos salvos e o rascunho atual serão substituídos.")){
        els.backupFile.value="";
        return;
      }

      savedCases=normalizeSavedCases(backup.savedCases);

      const draft=backup.draft && typeof backup.draft==="object" ? backup.draft : {};
      level=normalizeLevel(draft.level);
      difficultyByLevel={
        pequeno:normalizeDifficulty(
          draft.difficultyByLevel?.pequeno ||
          (level==="pequeno" ? draft.difficulty : null),
          "pequeno"
        ),
        grande:normalizeDifficulty(
          draft.difficultyByLevel?.grande ||
          (level==="grande" ? draft.difficulty : null),
          "grande"
        )
      };
      difficulty=difficultyByLevel[level];

      workspaces={
        pequeno:normalizeState("pequeno",draft.workspaces?.pequeno),
        grande:normalizeState("grande",draft.workspaces?.grande)
      };

      els.caseName.value=String(draft.caseName || "");
      els.bookName.value=String(draft.bookName || "");
      els.caseNumber.value=String(draft.caseNumber || "");
      els.caseStatus.value=normalizeCaseStatus(draft.caseStatus);
      els.caseNotes.value=String(draft.caseNotes || "");
      els.notesDetails.open=Boolean(els.caseNotes.value);

      currentCaseId=null;
      clearUndo();
      clearDirty();

      refreshLevelTabs();
      renderDifficultySelect();
      renderEditor();
      renderBoard();
      renderSavedCases();
      resetBoardScroll();
      setScreen("resolver");
      persistNow();
      flash("Backup restaurado.");
    }catch(error){
      console.warn(error);
      alert("Não foi possível importar esse arquivo de backup.");
    }finally{
      els.backupFile.value="";
    }
  };

  reader.onerror=()=>{
    alert("Não foi possível ler o arquivo de backup.");
    els.backupFile.value="";
  };

  reader.readAsText(file);
}

function renderSavedCases(){
  els.savedCount.textContent=String(savedCases.length);
  els.savedList.innerHTML="";

  if(savedCases.length===0){
    const empty=document.createElement("div");
    empty.className="saved-empty";
    empty.textContent="Nenhum caso salvo.";
    els.savedList.appendChild(empty);
    return;
  }

  [...savedCases]
    .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .forEach(item=>{
      const row=document.createElement("article");
      row.className="saved-case";

      const info=document.createElement("div");
      info.className="saved-case-info";

      const name=document.createElement("div");
      name.className="saved-case-name";
      name.textContent=item.name;
      name.title=item.name;

      const metaLine=document.createElement("div");
      metaLine.className="saved-case-meta-line";

      const status=document.createElement("span");
      status.className=`status-badge ${normalizeCaseStatus(item.status)}`;
      status.textContent=caseStatusLabel(item.status);

      const meta=document.createElement("span");
      meta.className="saved-case-meta";
      meta.textContent=`${difficultyConfig[item.difficulty].label} • ${formatDate(item.updatedAt)}`;

      metaLine.append(status,meta);

      const details=document.createElement("div");
      details.className="saved-case-details";
      const detailsParts=[];
      if(item.bookName) detailsParts.push(item.bookName);
      if(item.caseNumber) detailsParts.push(`Caso ${item.caseNumber}`);
      details.textContent=detailsParts.join(" • ");

      info.append(name,metaLine,details);

      const actions=document.createElement("div");
      actions.className="saved-case-actions";

      const open=document.createElement("button");
      open.type="button";
      open.className="mini-action open";
      open.textContent="Abrir";
      open.addEventListener("click",()=>openSavedCase(item));

      const remove=document.createElement("button");
      remove.type="button";
      remove.className="mini-action delete";
      remove.textContent="Excluir";
      remove.addEventListener("click",()=>deleteSavedCase(item));

      actions.append(open,remove);
      row.append(info,actions);
      els.savedList.appendChild(row);
    });
}

/* Eventos */
els.appTabs.forEach(btn=>{
  btn.addEventListener("click",()=>setScreen(btn.dataset.screen));
});

els.levelTabs.forEach(btn=>{
  btn.addEventListener("click",()=>switchLevel(btn.dataset.level));
});

els.difficultySelect.addEventListener("change",()=>{
  difficulty=normalizeDifficulty(els.difficultySelect.value,level);
  difficultyByLevel[level]=difficulty;
  markDirty();
});

els.menuToggle.addEventListener("click",toggleMenu);
els.choiceToggle.addEventListener("click",toggleChoicePanel);
els.saveCase.addEventListener("click",saveCurrentCase);
els.undoAction.addEventListener("click",undoLastAction);
els.newCase.addEventListener("click",newCase);
els.clearCase.addEventListener("click",clearCurrentCase);
els.printCase.addEventListener("click",printCurrentCase);

[
  els.caseName,
  els.bookName,
  els.caseNumber,
  els.caseNotes
].forEach(input=>input.addEventListener("input",markDirty));

els.caseStatus.addEventListener("change",markDirty);
els.notesDetails.addEventListener("toggle",schedulePersist);

els.exportBackup.addEventListener("click",exportBackup);
els.importBackup.addEventListener("click",()=>els.backupFile.click());
els.backupFile.addEventListener("change",()=>{
  importBackupFile(els.backupFile.files?.[0]);
});

window.addEventListener("resize",()=>requestAnimationFrame(updateScrollHint));
window.addEventListener("beforeprint",buildPrintSheet);
window.addEventListener("afterprint",cleanupPrintSheet);
window.addEventListener("beforeunload",persistNow);

/* Inicialização */
loadPersisted();
workspaces.pequeno=normalizeState("pequeno",workspaces.pequeno);
workspaces.grande=normalizeState("grande",workspaces.grande);
difficulty=normalizeDifficulty(difficultyByLevel[level],level);
difficultyByLevel[level]=difficulty;

refreshLevelTabs();
renderDifficultySelect();
renderEditor();
renderBoard();
renderSavedCases();
syncMenuArrow();
syncChoicePanel();
updateUndoButton();
setScreen(currentScreen);
persistNow();
