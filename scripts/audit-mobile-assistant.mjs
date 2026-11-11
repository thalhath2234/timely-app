// Render the production mobile assistant in react-native-web with fixture APIs,
// then drive it in Chromium: history, rename, delete, proposal review, discard,
// failed steps, and the composer. Native pickers, sheets and motion are substituted.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
const mobile = resolve(root, "apps/mobile");
const requireMobile = createRequire(resolve(mobile, "package.json"));
const requireWeb = createRequire(resolve(root, "apps/web/package.json"));
const { build } = requireWeb("esbuild");
const stubs = new Map();
const stub = (path, contents) => stubs.set(resolve(mobile, path), contents);
stub(
  "lib/auth/AuthProvider",
  'export const useAuth=()=>({user:{id:"audit-user"}});',
);
stub(
  "lib/networkState",
  "export const isOffline=()=>false; export const subscribeOffline=()=>()=>{};",
);
stub(
  "lib/hooks",
  `export const useSheetsQuery=()=>({data:[]}); export const useDocsQuery=()=>({data:[]}); export const useProjectsQuery=()=>({data:[]}); export const useTasksQuery=()=>({data:[]}); export const useSheetQuery=()=>({data:undefined}); export const useWorkspacesQuery=()=>({data:[]}); export const useAgentProvidersQuery=()=>({data:undefined}); export const useProviderModelsQuery=()=>({data:[]}); export const useChatPromptsQuery=()=>({data:undefined}); export const useDecisionFeedback=()=>({mutate(){}}); export const useDocQuery=()=>({data:undefined}); export const useTaskQuery=()=>({data:undefined}); export const useSaveTask=()=>({mutate(){},mutateAsync:async()=>{},isPending:false}); export const useSetChecklistItem=()=>({mutate(){},isPending:false}); export const useBotIcons=()=>({data:{}}); const bot=(id,name,watch,over={})=>({id,name,description:"",status:"active",pauseReason:null,origin:"app",originClient:"",judgeMode:"rules",intervalMinutes:60,urgent:false,desktop:true,phone:true,snoozedUntil:null,nextCheckAt:new Date(Date.now()+1800000).toISOString(),lastCheckAt:new Date(Date.now()-720000).toISOString(),lastOkAt:null,strikes:0,health:{code:"working",line:""},alertsToday:0,watches:[{id:id+"_w",url:"",read:"",selector:"",source:"",symbol:"",currency:"",rules:[],health:{code:"working",line:""},lastReadingAt:null,summary:"",site:"",title:"",value:null,excerpt:"",latestItem:null,lastChangedAt:null,spark:null,dayChangePct:null,...watch}],createdAt:"2026-11-01T00:00:00Z",updatedAt:"2026-11-02T00:00:00Z",checking:false,runNowAt:null,floorLine:"",strip:"nnnn",latestAlert:null,itemsToday:0,...over}); const bots=[bot("bot_gonews","Go news feed",{kind:"feed",site:"go.dev"}),bot("bot_gorelease","Go release news",{kind:"feed",site:"go.dev"},{status:"paused"}),bot("bot_btc","Bitcoin under $70,000",{kind:"price",source:"coinbase",symbol:"BTC",currency:"USD"})]; export const useBotsQuery=()=>({data:{bots,summary:{checksToday:3,alertsToday:0,nextCheckAt:null}}}); export const useBotDefaultsQuery=()=>({data:{desktop:true,phone:true,urgent:false}}); export const useRateAlert=()=>({mutate(){},isPending:false}); export const learnedLine=(lesson)=>"Learned: "+lesson; export const useAgentChatSettingsQuery=()=>({data:undefined}); export const usePatchAgentChatSettings=()=>({mutate(){},mutateAsync:async()=>{},isPending:false});
import {useSyncExternalStore} from "react";
const learnListeners=new Set(); let learnVersion=0;
const learnBump=()=>{learnVersion++;learnListeners.forEach((f)=>f());};
const useLearnVersion=()=>useSyncExternalStore((f)=>{learnListeners.add(f);return()=>learnListeners.delete(f);},()=>learnVersion);
const learnEvents=()=>Object.values(window.auditLearning||{}).flat();
export const useLearningSettingsQuery=()=>({data:{learning:true,searchHistory:true,useCaseCopied:false}});
export const useChatLearningQuery=(id)=>{useLearnVersion();return {data:((window.auditLearning||{})[id]||[]).map((e)=>({...e})),refetch:async()=>{}};};
export const useUndoLearning=()=>({isPending:false,variables:undefined,mutate(ids){for(const id of ids){window.auditActions.push({path:"/agent/learning/events/"+id+"/undo",method:"POST"});const ev=learnEvents().find((e)=>e.id===id);if(ev)ev.status="undone";}learnBump();}});
export const useDecidePendingLearning=()=>({isPending:false,variables:undefined,mutate({pendingIds,choice}){for(const id of pendingIds){window.auditActions.push({path:"/agent/learning/pending/"+id,method:"POST",body:{choice}});const ev=learnEvents().find((e)=>e.pendingId===id);if(ev)ev.status=choice==="keep"?"kept":"discarded";}learnBump();}});`,
);
stub(
  "lib/chat/storage",
  "export const removeLocalImage=async()=>{}; export const retainImage=async(_uid,uri)=>uri;",
);
stub(
  "lib/api/client",
  'export const api=async()=>fetch("/receipt.jpg"); export const getApiUrl=async()=>""; export const tunnelHeaders=()=>({});',
);
stub(
  "components/docs/RichDoc",
  `import React from "react"; import {Text} from "react-native";
const flat=(node)=>node?.text??(node?.content||[]).map(flat).join(node?.type==="doc"?"\\n":"");
export default ({content})=><Text style={{color:"#1b1c24",fontSize:14,lineHeight:22}}>{flat(content)}</Text>;`,
);
stub(
  "components/ui/AnimatedPressable",
  'export {Pressable as default} from "react-native";',
);
stub(
  "components/ui/ListEnter",
  'import React from "react"; import {View} from "react-native"; export default ({children})=><View>{children}</View>;',
);
stub(
  "components/ui/LoopImage",
  'import React from "react"; import {View} from "react-native"; export default ({style})=><View style={style}/>;',
);
stub(
  "components/ui/EmptyState",
  'import React from "react"; import {View,Text} from "react-native"; export default ({title,description})=><View style={{padding:24,alignItems:"center",gap:6}}><Text style={{color:"#f1f5f9",fontWeight:"600"}}>{title}</Text><Text style={{color:"#8b99b0",fontSize:13,textAlign:"center"}}>{description}</Text></View>;',
);
stub(
  "components/ui/BottomSheet",
  `import React from "react"; import {View,Text,Pressable} from "react-native";
export default ({open,title,children,footer,onClose})=>open?<View role="dialog" aria-label={title} style={{position:"fixed",bottom:0,left:0,right:0,backgroundColor:"#1d2029",padding:20,zIndex:100,gap:12,maxHeight:"90vh",overflow:"auto",borderTopLeftRadius:28,borderTopRightRadius:28}}><Text style={{color:"white",fontSize:20,fontWeight:"800"}}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close sheet" onPress={onClose}><Text style={{color:"#8b99b0"}}>Close</Text></Pressable>{children}{footer}</View>:null;
export const SheetOption=({children,onSelect,leading})=><Pressable accessibilityRole="button" accessibilityLabel={typeof children==="string"?children:undefined} onPress={onSelect} style={{padding:16,flexDirection:"row",gap:12,alignItems:"center"}}>{leading}{typeof children==="string"?<Text style={{color:"white",fontSize:15}}>{children}</Text>:children}</Pressable>;`,
);
stub(
  "lib/api/chat",
  `
const now=Date.now();
const iso=(minutesAgo)=>new Date(now-minutesAgo*60000).toISOString();
const plan=()=>[
 {tool:"create_sheet",summary:"Create “PDF tool budget” in your PDF tool project.",status:"pending",arguments:{title:"PDF tool budget"}},
 {tool:"update_sheet",summary:"Add Item, Quantity, Unit price, and Total columns, with initial expense rows.",status:"pending",arguments:{sheetId:"$0.sheet.id",columns:[{id:"item",name:"Item",type:"text"},{id:"quantity",name:"Quantity",type:"number"}],rows:[{cells:{item:"Hosting",quantity:"1"}}]}},
];
const shop={kind:"page",url:"https://www.amazon.in/dp/B0DFC8QZ4M",read:"product_price",rules:[{kind:"below",threshold:18000}]};
const feed={kind:"feed",url:"https://go.dev/blog/feed.atom"};
const shopRead={index:0,watchId:"",ok:true,kind:"page",read:"product_price",site:"amazon.in",summary:"₹19,999",value:19999,currency:"INR",text:"",items:null,excerpt:{text:"M.R.P.: Rs 22,900 Deal Price: Rs 19,999 (13% off)",mark:[30,39],struck:[[8,17]]},candidates:[{label:"Deal Price",amount:19999,currency:"INR",selector:"span.a-price-whole",struck:false,from:"text"},{label:"M.R.P.",amount:22900,currency:"INR",selector:"span.a-text-price",struck:true,from:"text"}],health:null,at:iso(2)};
const feedRead={index:1,watchId:"",ok:true,kind:"feed",read:"",site:"go.dev",summary:"3 posts",value:null,currency:"",text:"",items:[{title:"Go 1.25 is released",url:"https://go.dev/blog/go1.25",publishedAt:null}],excerpt:null,candidates:null,health:null,at:iso(5)};
const goFeed={id:"bot_gonews_w",kind:"feed",site:"go.dev",title:"go.dev · Feed",summary:"12 posts",value:null,currency:"",excerpt:"",items:[{title:"Go 1.26 is released",url:"https://go.dev/blog/go1.26",publishedAt:iso(60*26)}],lastChangedAt:iso(60*26)};
const botAnswer=(id,name,status,fresh,freshLine,over={})=>({bot:{id,name,status,pauseReason:status==="paused"?"user":null,health:{code:"working",line:""}},fresh,freshLine,checkedAt:iso(1),nextCheckAt:iso(-55),watches:[],findings:[],alertsToday:0,...over});
const botStep=(watches,preview)=>({tool:"create_bot",summary:"Make a bot that watches the earbuds' price",status:"pending",arguments:{name:"Pixel Buds Pro 2 under ₹18,000",description:"tell me when these earbuds drop",intervalMinutes:0,watches},preview});
const chats={
 budget:{id:"budget",title:"Build a project budget",status:"approval",phase:"apply",webSearch:false,context:[{kind:"project",label:"PDF tool",value:"projects/pdf"},{kind:"selection",label:"Cells B2:C4",value:"B2:C4"}],revision:2,unread:true,error:"",createdAt:iso(40),updatedAt:iso(3),plan:plan(),messages:[
  {id:"m1",role:"user",content:"Create a budget sheet for the PDF tool project.",createdAt:iso(40)},
  {id:"m2",role:"assistant",content:"I’ll create a budget in your PDF tool project, with quantities, unit prices, and calculated totals. Here’s the proposed structure.",createdAt:iso(39)},
  {id:"m3",role:"assistant",kind:"archive",content:"Previous changes",createdAt:iso(20),steps:[{tool:"create_project",summary:"Create “PDF tool” project.",status:"done",arguments:{name:"PDF tool"},result:{project:{id:"pdf",name:"PDF tool"}}}]},
  {id:"m4",role:"assistant",kind:"notice",content:"Done — your changes are saved.",createdAt:iso(19)},
  {id:"m5",role:"user",content:"Now add the budget sheet please.",createdAt:iso(4)},
 ]},
 japanese:{id:"japanese",title:"Learn Japanese workspace",status:"failed",phase:"apply",webSearch:true,context:[],revision:5,unread:false,error:"Workspace name already exists",createdAt:iso(60*30),updatedAt:iso(60*26),plan:[{tool:"create_workspace",summary:"Create the “Japanese” workspace.",status:"failed",error:"Workspace name already exists",arguments:{name:"Japanese"}},{tool:"create_task",summary:"Add three 30-minute study sessions.",status:"pending",arguments:{}}],messages:[{id:"j1",role:"user",content:"Create a workspace for learning Japanese and add three study sessions.",createdAt:iso(60*30)},{id:"j2",role:"assistant",content:"Here is the plan.",createdAt:iso(60*29)}]},
 standup:{id:"standup",title:"Move standup to Monday and Tuesday",status:"idle",phase:"plan",webSearch:false,context:[],revision:9,unread:false,error:"",createdAt:iso(60*24*3),updatedAt:iso(60*24*3),plan:[],messages:[{id:"s1",role:"user",content:"Change the days to monday and tuesday for the recurring standup meeting.",createdAt:iso(60*24*3)},{id:"s2",role:"assistant",content:"Done — the standup now repeats on Monday and Tuesday from next week.",createdAt:iso(60*24*3)}]},
 settings:{id:"settings",title:"Yo",status:"idle",phase:"plan",webSearch:false,context:[{kind:"location",label:"Current screen",value:"/tasks"},{kind:"tasks",label:"3 selected tasks",value:"[]"}],revision:3,unread:false,error:"",createdAt:iso(2),updatedAt:iso(2),plan:[],messages:[{id:"y1",role:"user",content:"Yo",createdAt:iso(2)},{id:"y2",role:"assistant",content:"Hey! What would you like to do?",createdAt:iso(2)}]},
 bot:{id:"bot",title:"Earbuds price watch",status:"approval",phase:"review",webSearch:false,context:[],revision:4,unread:false,error:"",createdAt:iso(3),updatedAt:iso(2),plan:[botStep([shop],{watches:[shopRead]})],messages:[{id:"b1",role:"user",content:"tell me when these earbuds drop under 18,000 on Amazon amazon.in/dp/B0DFC8QZ4M",createdAt:iso(3)},{id:"b2",role:"assistant",content:"I opened the page once to find the price. This bot checks it every 6 hours and tells you once when it goes under ₹18,000.",createdAt:iso(2)}]},
 botfeed:{id:"botfeed",title:"Go blog posts",status:"approval",phase:"review",webSearch:false,context:[],revision:2,unread:false,error:"",createdAt:iso(5),updatedAt:iso(5),plan:[botStep([shop,feed],{watches:[shopRead,feedRead]})],messages:[{id:"f1",role:"user",content:"Watch the earbuds and the Go blog",createdAt:iso(5)}]},
 botlink:{id:"botlink",title:"Release posts first",status:"approval",phase:"review",webSearch:false,context:[],revision:2,unread:false,error:"",createdAt:iso(7),updatedAt:iso(7),plan:[{tool:"update_bot",summary:"Have Go release news check release posts first",status:"pending",arguments:{bot:"bot_gonews",passesTo:[{bot:"bot_gorelease",filter:["release"]}]},before:{id:"bot_gonews",name:"Go news feed",description:"",status:"active",intervalMinutes:30,judgeMode:"rules",desktop:true,phone:true,urgent:false,watches:[{id:"bot_gonews_w",...feed,read:"",selector:"",source:"",symbol:"",currency:"",rules:[{kind:"new_item"}]}],passesTo:[]}}],messages:[{id:"l1",role:"user",content:"When Go news feed finds a release post, have Go release news check it first",createdAt:iso(7)}]},
 botbrief:{id:"botbrief",title:"Morning brief",status:"approval",phase:"review",webSearch:false,context:[],revision:2,unread:false,error:"",createdAt:iso(8),updatedAt:iso(8),plan:[{tool:"create_bot",summary:"Make a morning brief",status:"pending",arguments:{name:"Morning brief",description:"Each morning, sum up what my other bots found.",intervalMinutes:1440,kind:"brief",sources:["bot_gonews","bot_btc"],briefTime:"08:00",watches:[]}}],messages:[{id:"m1",role:"user",content:"Every morning at 08:00, sum up what my other bots found",createdAt:iso(8)}]},
 botfail:{id:"botfail",title:"Robot check",status:"approval",phase:"review",webSearch:false,context:[],revision:2,unread:false,error:"",createdAt:iso(6),updatedAt:iso(6),plan:[botStep([shop],{error:"The site asks not to be read"})],messages:[{id:"x1",role:"user",content:"Watch this page",createdAt:iso(6)}]},
 tag:{id:"tag",title:"Go news this week",status:"idle",phase:"review",webSearch:false,context:[],revision:6,unread:false,error:"",createdAt:iso(9),updatedAt:iso(3),plan:[],messages:[
  {id:"t1",role:"user",content:"@Go news feed anything new this week?",botTags:["bot_gonews"],createdAt:iso(9)},
  {id:"t2",role:"assistant",content:"Yes: Go 1.26 came out yesterday. That is the only new post this week.",createdAt:iso(8),botAnswers:[botAnswer("bot_gonews","Go news feed","active","checked_now","Checked just now",{alertsToday:1,watches:[goFeed],findings:[{id:"fnd_1",botId:"bot_gonews",checkId:null,watchId:"bot_gonews_w",kind:"item",title:"Go 1.26 is released",why:"A new post in the feed",url:"https://go.dev/blog/go1.26",price:null,currency:"",changePct:null,urgency:"normal",outsideData:true,alerted:true,digestedAt:null,createdAt:iso(60*26)}]})]},
  {id:"t3",role:"user",content:"@GPU deals under $400 @Go release news what do you see?",botTags:["bot_gpu","bot_gorelease"],createdAt:iso(4)},
  {id:"t4",role:"assistant",content:"The GPU deals bot is checking now. Go release news is paused; its last reading is from Nov 2.",createdAt:iso(3),botAnswers:[botAnswer("bot_gpu","GPU deals under $400","active","waiting","Checking now; the result shows on the bot",{watches:[{...goFeed,id:"bot_gpu_w",site:"reddit.com",title:"reddit.com · Feed",summary:"40 posts",items:[],excerpt:"RTX 4070 Super, $389 at Newegg"},{...goFeed,id:"bot_gpu_w2",site:"slickdeals.net",title:"slickdeals.net · Feed",summary:"25 posts",items:[],excerpt:""}]}),botAnswer("bot_gorelease","Go release news","paused","paused","Paused, so this is from Nov 2",{nextCheckAt:null,watches:[{...goFeed,id:"bot_gorelease_w",summary:"8 posts"}]})]},
 ]},
 learned:{id:"learned",title:"Import my bank CSV",status:"idle",phase:"plan",webSearch:false,engine:"",runEngine:"agent",context:[],revision:3,unread:false,error:"",createdAt:iso(12),updatedAt:iso(11),plan:[],messages:[{id:"lr1",role:"user",content:"Import this month's bank CSV into my budget sheet",createdAt:iso(12)},{id:"lr2",role:"assistant",engine:"agent",agentRun:"run_l1",content:"Imported 42 rows into Budget. I noted how your bank lays out its CSV, so next time is quicker.",createdAt:iso(11)}]},
 running:{id:"running",title:"Plan my week",status:"running",phase:"plan",webSearch:false,context:[],revision:1,unread:false,error:"",createdAt:iso(1),updatedAt:iso(1),plan:[],messages:[{id:"r1",role:"user",content:"Help me plan this week.",createdAt:iso(1)}]},
};
window.auditChats=chats;
const learnEvent=(over)=>({id:"",kind:"skill",action:"created",subject:"",before:"",after:"",origin:"chat",conversationId:"learned",runId:"run_l1",botId:"",taintedSources:[],status:"applied",ledgerEntryId:"",pendingId:"",summary:"",createdAt:iso(11),updatedAt:iso(11),...over});
window.auditLearning={learned:[
 learnEvent({id:"lev1",subject:"bank-csv-import",after:"Read the CSV's Date, Description and Amount columns",ledgerEntryId:"led1",summary:"How to import your bank's CSV"}),
 learnEvent({id:"lev2",action:"patched",subject:"flipkart-price-read",status:"staged",pendingId:"lp1",taintedSources:[{kind:"web",tool:"web_extract",host:"flipkart.com"}],summary:"Read the deal price, not the struck-out M.R.P."}),
]};
const summary=(c)=>({id:c.id,title:c.title,status:c.status,phase:c.phase,webSearch:c.webSearch,revision:c.revision,unread:c.unread,error:c.error,createdAt:c.createdAt,updatedAt:c.updatedAt});
export const uploadChatImage=async()=>({id:"photo",expiresAt:"2099-01-01"});
export const renameChat=(id,title)=>chatRequest("/"+id,"PATCH",{title});
export const deleteChat=(id)=>chatRequest("/"+id,"DELETE");
export const configureChatAgent=(id,patch)=>chatRequest("/"+id,"PATCH",patch);
export const steerChat=(id,text)=>chatRequest("/"+id+"/steer","POST",{text});
export const setChatNoLearning=(id,noLearning)=>chatRequest("/"+id,"PATCH",{noLearning});
export const undoChatChange=(id,revision,messageId)=>chatRequest("/"+id+"/undo","POST",{revision,messageId});
export async function chatRequest(path,method="GET",body){
 window.auditActions.push({path,method,body,overlaps:method!=="GET"&&window.auditWrites>0});
 if(method==="GET")return answer(path,method,body);
 window.auditWrites=(window.auditWrites||0)+1;
 try{return await answer(path,method,body);}finally{window.auditWrites--;}
}
async function answer(path,method,body){
 const match=path.match(/^\\/([^/]+)(.*)$/);
 const chat=match?chats[match[1]]:undefined;
 const action=match?match[2]:"";
 if(method==="POST"&&path===""){const id="new"+Date.now();chats[id]={id,title:body.content.slice(0,70),status:"queued",phase:"plan",webSearch:body.webSearch,context:body.context||[],revision:1,unread:false,error:"",createdAt:iso(0),updatedAt:iso(0),plan:[],messages:[{id:"u",role:"user",content:body.content,createdAt:iso(0)}]};return structuredClone(chats[id]);}
 if(!path)return Object.values(chats).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(summary);
 if(!chat)throw new Error("Conversation not found");
 if(method==="DELETE"){delete chats[chat.id];return;}
 if(method!=="GET")await new Promise(r=>setTimeout(r,window.auditLatency||0));
 if(method==="PATCH"&&window.auditFailPatch)throw new Error("Wait or stop before changing context");
 if(method==="PATCH"){const {provider,model,...rest}=body;Object.assign(chat,rest);if(provider!==undefined){chat.chosenProvider=provider;chat.chosenModel=model||"";}return structuredClone(chat);}
 if(action==="/read"){chat.unread=false;return;}
 if(action==="/reject"){chat.messages.push({id:"a"+Date.now(),role:"assistant",kind:"archive",content:"Discarded changes",createdAt:iso(0),steps:chat.plan.map(s=>({...s,status:"discarded"}))},{id:"n"+Date.now(),role:"assistant",kind:"notice",content:"Proposal discarded. Nothing was changed.",createdAt:iso(0)});chat.plan=[];chat.status="idle";chat.revision++;return structuredClone(chat);}
 if(action==="/approve"){chat.status="running";chat.revision++;return structuredClone(chat);}
 if(action==="/retry"){chat.status="approval";chat.error="";chat.plan=chat.plan.map(s=>s.status==="done"?s:{...s,status:"pending",error:undefined});chat.revision++;return structuredClone(chat);}
 if(action==="/stop"){chat.status="stopped";chat.messages.push({id:"st"+Date.now(),role:"assistant",kind:"notice",content:"Stopped. Completed changes are kept.",createdAt:iso(0)});chat.revision++;return structuredClone(chat);}
 if(action==="/messages"){chat.messages.push({id:"u"+Date.now(),role:"user",content:body.content,createdAt:iso(0)});chat.status="queued";chat.revision++;return structuredClone(chat);}
 return structuredClone(chat);
}`,
);
const modules = {
  "expo-clipboard": "export const getImageAsync=async()=>null;",
  "expo-image": 'export {Image} from "react-native";',
  "expo-image-picker":
    "export const requestCameraPermissionsAsync=async()=>({granted:true});export const launchCameraAsync=async()=>({canceled:true});export const launchImageLibraryAsync=launchCameraAsync;",
  "expo-image-manipulator":
    'export const ImageManipulator={manipulate:()=>({resize(){},renderAsync:async()=>({saveAsync:async()=>({uri:"/receipt.jpg"})})})};export const SaveFormat={JPEG:"jpeg"};',
  "expo-document-picker":
    "export const getDocumentAsync=async()=>({canceled:true});",
  "expo-file-system/legacy":
    'export const getInfoAsync=async()=>({exists:true,size:1000});export const cacheDirectory="/";export const deleteAsync=async()=>{};export const writeAsStringAsync=async()=>{};export const EncodingType={Base64:"base64"};',
  "expo-secure-store":
    "export const getItemAsync=async()=>null;export const setItemAsync=async()=>{};",
  "expo-router":
    'export const useFocusEffect=()=>{};export const usePathname=()=>"/assistant";export const useNavigation=()=>({isFocused:()=>true});',
  "react-native-safe-area-context":
    'export {View as SafeAreaView} from "react-native";',
};
const rnStub = `export * from ${JSON.stringify(requireMobile.resolve("react-native-web"))};`;
const entry = `import React,{useState} from "react";import {createRoot} from "react-dom/client";import {QueryClient,QueryClientProvider} from "@tanstack/react-query";import Assistant from "./components/chat/Assistant";import {Context,emptyDraft} from "./lib/chat/runtime";
window.auditActions=[];
function App(){const [open,setOpen]=useState(true);window.auditOpen=setOpen;const initial=new URLSearchParams(location.search).get("chat");const [chatId,select]=useState(initial);const [cache,updateCache]=useState({receiptEdits:{},draft:emptyDraft(),chats:[],conversations:{}});const state={visible:true,foreground:true,hydrated:true,chatId,cache,updateCache,setDraft:update=>updateCache(value=>({...value,draft:update(value.draft||emptyDraft())})),acceptSend:(_old,id)=>select(id),select,currentContext:()=>[{kind:"location",label:"Current screen",value:"/tasks"},{kind:"tasks",label:"3 selected tasks",value:"[]"}],setBackHandler:()=>{},openResult:href=>{window.auditResult=href},close:()=>{window.auditClosed=true},screenshot:async()=>"/receipt.jpg"};return <QueryClientProvider client={client}><Context.Provider value={state}>{open?<Assistant/>:null}</Context.Provider></QueryClientProvider>};const client=new QueryClient({defaultOptions:{queries:{retry:false}}});createRoot(document.getElementById("root")).render(<App/>);`;
const output = await build({
  stdin: { contents: entry, resolveDir: mobile, loader: "tsx" },
  bundle: true,
  write: false,
  format: "iife",
  // Some native-first packages read Node globals when they load.
  banner: { js: "var process = { env: {} }, global = globalThis;" },
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"', __DEV__: "true" },
  mainFields: ["browser", "module", "main"],
  resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".js"],
  plugins: [
    {
      name: "mobile-audit",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (args.path === "react-native")
            return { path: "rn-audit", namespace: "audit" };
          if (modules[args.path])
            return { path: args.path, namespace: "audit" };
          const absolute = resolve(
            dirname(args.importer || resolve(mobile, "entry.tsx")),
            args.path,
          ).replace(/\.(tsx?|jsx?)$/, "");
          if (stubs.has(absolute))
            return { path: absolute, namespace: "audit" };
        });
        b.onLoad({ filter: /.*/, namespace: "audit" }, (args) => ({
          contents:
            args.path === "rn-audit"
              ? rnStub
              : modules[args.path] || stubs.get(args.path),
          loader: "tsx",
          resolveDir: mobile,
        }));
      },
    },
  ],
});
const bundle = output.outputFiles[0].contents;
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/app.js")) {
    res.setHeader("content-type", "text/javascript");
    res.end(bundle);
    return;
  }
  if (req.url === "/receipt.jpg") {
    res.setHeader("content-type", "image/svg+xml");
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="white"/><text x="20" y="40">Fixture receipt</text></svg>',
    );
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mobile assistant audit</title><style>html,body,#root{margin:0;height:100%;background:#111319}#root{max-width:430px;height:100%;margin:auto}</style><div id="root"></div><script src="/app.js"></script>',
  );
}).listen(4002, "0.0.0.0");
console.log(
  "Mobile assistant audit on :4002 (fixture APIs; native sheets substituted)",
);
if (!process.env.AUDIT_CHECK) process.on("SIGINT", () => process.exit(0));
else {
  const { chromium, expect } = requireWeb("@playwright/test");
  const browser = await chromium.launch({
    ...(process.env.CHAT_BROWSER
      ? { executablePath: process.env.CHAT_BROWSER }
      : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const actions = () => page.evaluate(() => window.auditActions);
  try {
    // Welcome + composer
    await page.goto("http://localhost:4002/");
    await page.getByText("What would you like to make happen?").waitFor();
    await page.screenshot({ path: "/tmp/timely-mobile-welcome.png" });
    await page.getByLabel("Add current screen as context").click();
    await page.getByLabel("Remove 3 selected tasks context").waitFor();
    await page.getByLabel("Attach image").click();
    await page.getByRole("dialog", { name: "Attach image" }).waitFor();
    await page.getByLabel("Close sheet").click();
    // History with groups, unread badge, rename and delete
    await page.getByLabel(/Chat history/).click();
    await page.getByText("Needs you", { exact: true }).waitFor();
    await page.getByText("This week", { exact: true }).waitFor();
    await page.screenshot({ path: "/tmp/timely-mobile-history.png" });
    await page
      .getByLabel("Open Learn Japanese workspace")
      .click({ delay: 700 });
    await page
      .getByRole("dialog", { name: "Learn Japanese workspace" })
      .waitFor();
    await page.getByLabel("Rename").click();
    await page.getByLabel("Chat title").fill("Japanese study");
    await page.getByLabel("Save").click();
    await page.getByLabel("Open Japanese study").waitFor();
    assert(
      (await actions()).some(
        (a) => a.method === "PATCH" && a.body.title === "Japanese study",
      ),
      "rename not sent",
    );
    await page
      .getByLabel("Open Move standup to Monday and Tuesday")
      .click({ delay: 700 });
    await page.getByText("Delete conversation").click();
    await page.getByRole("button", { name: "Delete" }).last().click();
    await expect(
      page.getByLabel("Open Move standup to Monday and Tuesday"),
    ).toHaveCount(0);
    assert(
      (await actions()).some(
        (a) => a.method === "DELETE" && a.path === "/standup",
      ),
      "delete not sent",
    );
    // Thread with archive, notice, plan summary; proposal page; discard
    await page.getByLabel("Open Build a project budget").click();
    await page.getByText("Changes ready for your review").waitFor();
    await page.getByLabel("Earlier proposal, 1 changes").waitFor();
    await page.getByText("Done — your changes are saved.").waitFor();
    await page.screenshot({
      path: "/tmp/timely-mobile-thread.png",
      fullPage: true,
    });
    await page.getByLabel("Review and apply").click();
    await page.getByText("Ready for your review").waitFor();
    await page.getByLabel("Apply all").waitFor();
    // One card is open at a time; the second shows the rows it adds.
    await page
      .getByText(
        "Add Item, Quantity, Unit price, and Total columns, with initial expense rows.",
      )
      .click();
    await page.getByText("Hosting").waitFor();
    await page.screenshot({
      path: "/tmp/timely-mobile-proposal.png",
      fullPage: true,
    });
    await page.getByLabel("Discard all").click();
    await page.getByText("Proposal discarded. Nothing was changed.").waitFor();
    assert(
      (await actions()).some(
        (a) => a.path === "/budget/reject" && a.body.revision === 2,
      ),
      "reject not bound to revision",
    );
    // Failed run shows the failing step and retry resets it
    await page.goto("http://localhost:4002/?chat=japanese");
    await page.getByText("Some changes did not finish").first().waitFor();
    await page.getByLabel("View changes").click();
    await page.getByText("Workspace name already exists").first().waitFor();
    await page.getByText("Failed", { exact: true }).first().waitFor();
    await page.screenshot({
      path: "/tmp/timely-mobile-failed.png",
      fullPage: true,
    });
    await page.getByLabel("Review unfinished changes").click();
    await page.getByLabel("Apply all").waitFor();
    // Running state: stop from the composer
    await page.goto("http://localhost:4002/?chat=running");
    await page.getByText("Thinking it through…").first().waitFor();
    await page.getByLabel("Stop run").click();
    await page.getByText("Stopped. Completed changes are kept.").waitFor();
    // Settings in a saved chat change at once, without dimming the composer
    await page.goto("http://localhost:4002/?chat=settings");
    await page.getByText("Hey! What would you like to do?").waitFor();
    const search = page.getByLabel("Web search");
    // React Native Web ignores accessibilityState, so read the icon's tint.
    const tint = () =>
      search.evaluate((el) => el.querySelector("svg").getAttribute("stroke"));
    const offTint = await tint();
    const patches = async () =>
      (await actions()).filter(
        (a) => a.method === "PATCH" && a.path === "/settings",
      );
    const problems = [];
    await page.evaluate(() => {
      window.auditLatency = 400;
      window.auditFrames = [];
      const opacity = (selector) => {
        const el = document.querySelector(selector);
        return el ? Number(getComputedStyle(el).opacity) : 1;
      };
      const read = () => {
        const input = document.querySelector(
          '[aria-label="Message the assistant"]',
        );
        window.auditFrames.push({
          dimmed: Math.min(
            opacity('[aria-label="Attach image"]'),
            opacity('[aria-label="Add current screen as context"]'),
            opacity('[aria-label^="Model:"]'),
          ),
          readOnly: !!input?.readOnly,
          uploading: document.body.innerText.includes("Uploading image"),
        });
        requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
    });
    const frames = () => page.evaluate(() => window.auditFrames.splice(0));
    await search.click();
    await page.waitForTimeout(100);
    if ((await tint()) === offTint)
      problems.push("Web search did not turn on until the save finished");
    await page.waitForTimeout(500);
    const toggle = await frames();
    if (toggle.some((f) => f.dimmed < 1))
      problems.push(
        `the other composer buttons dimmed while saving (${toggle.filter((f) => f.dimmed < 1).length} frames)`,
      );
    if (toggle.some((f) => f.readOnly))
      problems.push(
        `the message box went read-only while saving (${toggle.filter((f) => f.readOnly).length} frames)`,
      );
    // force: without it the second tap waited for a locked composer to unlock,
    // so this passed on the build that blinked.
    await search.click({ force: true });
    await page.waitForTimeout(50);
    await search.click({ force: true });
    await page.waitForTimeout(1200);
    if (
      (await tint()) === offTint ||
      !(await page.evaluate(() => window.auditChats.settings.webSearch))
    )
      problems.push("off then on within one save did not end on");
    if ((await patches()).length !== 3)
      problems.push(`off then on saved ${(await patches()).length - 1} times`);
    const before = (await patches()).length;
    await page.getByLabel("Add current screen as context").click();
    await page.waitForTimeout(600);
    if ((await patches()).length !== before)
      problems.push("adding a screen that is already attached saved anyway");
    await search.click();
    await page.evaluate(() => window.auditOpen(false));
    await page.evaluate(() => window.auditOpen(true));
    await page.waitForTimeout(100);
    if ((await tint()) !== offTint)
      problems.push("closing and reopening mid-save showed the old setting");
    await page.waitForTimeout(600);
    await page.evaluate(() => (window.auditFailPatch = true));
    await search.click();
    await page.waitForTimeout(600);
    await page.evaluate(() => (window.auditFailPatch = false));
    if (
      (await tint()) !== offTint ||
      !(await page.getByText("Wait or stop before changing context").count())
    )
      problems.push("a failed save did not go back and say why");
    await frames();
    await search.click();
    await page.getByLabel("Message the assistant").fill("Plan my day");
    await page.getByLabel("Send message").click();
    await page.waitForTimeout(300);
    if ((await frames()).some((f) => f.uploading))
      problems.push('a text-only message said "Uploading image…"');
    await page.waitForTimeout(800);
    if (
      (await actions()).some(
        (a) => a.path.startsWith("/settings") && a.overlaps,
      )
    )
      problems.push("a send went out while a settings save was still running");
    assert.deepEqual(problems, [], "composer settings");
    // A bot proposal: its rows, the board card, what it reads and "That's not it".
    await page.goto("http://localhost:4002/?chat=bot");
    await page.getByText("New bot · Needs your OK").waitFor();
    await expect(page.getByLabel("Message the assistant")).toHaveAttribute(
      "placeholder",
      "Reply, or ask for changes to the bot",
    );
    await page.getByLabel("Review and apply").click();
    await page.getByText("Needs your OK", { exact: true }).waitFor();
    for (const text of [
      "amazon.in · Product price",
      "6 hours",
      "Price is below ₹18,000",
      "Rules only",
      "Desktop, Phone",
      "On approve",
      "Right now it reads: ₹19,999",
    ])
      await page.getByText(text, { exact: true }).first().waitFor();
    await page.getByLabel("Approve").waitFor();
    await page.screenshot({
      path: "/tmp/timely-mobile-bot.png",
      fullPage: true,
    });
    await page.getByLabel("That’s not it").click();
    const notIt = page.getByRole("dialog", {
      name: "Which price should it follow?",
    });
    await notIt.waitFor();
    await notIt.getByText("What it reads now").waitFor();
    await notIt.getByText("M.R.P.", { exact: true }).click();
    await page.screenshot({
      path: "/tmp/timely-mobile-bot-not-it.png",
      fullPage: true,
    });
    // The substituted sheet is not a modal, so the page's own footer sits
    // over its button; press it from the keyboard instead.
    await notIt.getByLabel("Follow the M.R.P.").focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    assert(
      (await actions()).some(
        (a) =>
          a.path === "/bot/messages" &&
          a.body.content ===
            'That\'s not it. Follow the “M.R.P.”, ₹22,900, on the amazon.in watch (selector "span.a-text-price").',
      ),
      "That's not it did not send the picked price",
    );
    // Two watches: each watch's rules sit under its name; a feed's
    // "That's not it" starts a reply in words.
    await page.goto("http://localhost:4002/?chat=botfeed");
    await page.getByLabel("Review and apply").click();
    await page.getByText("Watch 2", { exact: true }).waitFor();
    await page.getByText("A new post", { exact: true }).waitFor();
    await page.getByText("Go 1.25 is released").waitFor();
    await page.screenshot({
      path: "/tmp/timely-mobile-bot-two.png",
      fullPage: true,
    });
    await page.getByLabel("That’s not it").last().click();
    await expect(page.getByLabel("Message the assistant")).toHaveValue(
      "That’s not it: ",
    );
    await expect(page.getByLabel("Message the assistant")).toBeFocused();
    // A failed reading says why.
    await page.goto("http://localhost:4002/?chat=botfail");
    await page.getByLabel("Review and apply").click();
    await page.getByText("The site asks not to be read").first().waitFor();
    await expect(page.getByText(/^Right now it reads/)).toHaveCount(0);
    // A link proposal: the bot it passes to by name, never its id.
    await page.goto("http://localhost:4002/?chat=botlink");
    await page.getByLabel("Review and apply").click();
    await page
      .getByText("Go release news · mentions release", { exact: false })
      .first()
      .waitFor();
    await expect(page.getByText("bot_gorelease")).toHaveCount(0);
    await expect(page.getByText(/^Right now it reads/)).toHaveCount(0);
    await page.screenshot({
      path: "/tmp/timely-mobile-bot-link.png",
      fullPage: true,
    });
    // A brief proposal: the bots it sums up, when it sends, no reading.
    await page.goto("http://localhost:4002/?chat=botbrief");
    await page.getByLabel("Review and apply").click();
    for (const text of [
      "Go news feed",
      "Bitcoin under $70,000",
      "Daily at 08:00",
      "Timely",
    ])
      await page.getByText(text, { exact: true }).first().waitFor();
    await expect(page.getByText("Sums up", { exact: true })).toHaveCount(2);
    await expect(page.getByText("First check", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/^Right now it reads/)).toHaveCount(0);
    await page.screenshot({
      path: "/tmp/timely-mobile-bot-brief.png",
      fullPage: true,
    });
    // Tagged bots answer as cards under the reply: fresh, still checking,
    // and paused; Open bot goes to the bot's sheet.
    await page.goto("http://localhost:4002/?chat=tag");
    const goAnswer = page.getByLabel("Go news feed answers");
    await goAnswer.waitFor();
    for (const text of [
      "Checked just now · 1 alert today",
      "go.dev · Feed",
      "12 posts",
      "Found this week",
    ])
      await goAnswer.getByText(text, { exact: true }).first().waitFor();
    await page
      .getByLabel("GPU deals under $400 answers")
      .getByText("Checking now; the result shows on the bot")
      .waitFor();
    const paused = page.getByLabel("Go release news answers");
    await paused.getByText("Paused, so this is from Nov 2").waitFor();
    await expect(paused.getByText(/^Next check/)).toHaveCount(0);
    await page.screenshot({
      path: "/tmp/timely-mobile-tag-answer.png",
      fullPage: true,
    });
    await page.getByLabel("Open Go news feed").click();
    assert.equal(
      await page.evaluate(() => window.auditResult),
      "/(app)/(tabs)/bots?bot=bot_gonews",
    );
    // The @-picker above the message box: pick, chip, send with botTags.
    await page.goto("http://localhost:4002/?chat=tag");
    const message = page.getByLabel("Message the assistant");
    await message.fill("@go");
    await page.getByLabel("Tag Go news feed").waitFor();
    await page.getByLabel("Tag Go release news").waitFor();
    await expect(page.getByLabel("Tag Bitcoin under $70,000")).toHaveCount(0);
    await page.screenshot({ path: "/tmp/timely-mobile-tag-picker.png" });
    await page.getByLabel("Tag Go news feed").click();
    await expect(message).toHaveValue("@Go news feed ");
    await page.getByLabel("Remove tag Go news feed").waitFor();
    await expect(page.getByLabel("Tag Go release news")).toHaveCount(0);
    // A chip removed takes its tag out of the message.
    await message.fill("@Go news feed @bit");
    await page.getByLabel("Tag Bitcoin under $70,000").click();
    await expect(message).toHaveValue("@Go news feed @Bitcoin under $70,000 ");
    await page.getByLabel("Remove tag Bitcoin under $70,000").click();
    await expect(message).toHaveValue("@Go news feed ");
    await message.fill("@Go news feed anything new?");
    await page.getByLabel("Send message").click();
    await page.waitForTimeout(300);
    const sent = (await actions()).find(
      (a) => a.path === "/tag/messages" && a.method === "POST",
    );
    assert(sent, "the tagged message was not sent");
    assert.deepEqual(sent.body.botTags, ["bot_gonews"]);
    assert.equal(sent.body.content, "@Go news feed anything new?");
    // What the agent learned (plan 9b.4): the chip with Undo, the Keep /
    // Discard card, and "Don't learn from this chat" in the title's menu.
    await page.goto("http://localhost:4002/?chat=learned");
    await page.getByText("Learned: skill 'bank-csv-import' created").waitFor();
    await page.getByText("Keep what Timely learned?").waitFor();
    await page.screenshot({
      path: "/tmp/timely-mobile-learned.png",
      fullPage: true,
    });
    await page.getByTestId("learning-undo").click();
    await page.getByTestId("learning-chip-undone").waitFor();
    await page.getByTestId("learning-keep").click();
    await expect(page.getByTestId("learning-card")).toHaveCount(0);
    await page.getByText("Learned: skill 'flipkart-price-read' updated").waitFor();
    assert.deepEqual(
      (await actions())
        .filter((a) => a.path.startsWith("/agent/learning/"))
        .map((a) => a.path),
      ["/agent/learning/events/lev1/undo", "/agent/learning/pending/lp1"],
    );
    await page.getByTestId("chat-menu-button").click();
    await page.getByRole("dialog", { name: "This chat" }).waitFor();
    await page
      .getByRole("switch", { name: "Don't learn from this chat" })
      .click();
    await page.getByText("Timely isn't learning from this chat.").waitFor();
    assert(
      (await actions()).some(
        (a) =>
          a.method === "PATCH" &&
          a.path === "/learned" &&
          a.body.noLearning === true,
      ),
      "noLearning not sent",
    );
    await page.screenshot({
      path: "/tmp/timely-mobile-dont-learn.png",
      fullPage: true,
    });
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      JSON.stringify({
        ok: true,
        screenshots: [
          "/tmp/timely-mobile-welcome.png",
          "/tmp/timely-mobile-history.png",
          "/tmp/timely-mobile-thread.png",
          "/tmp/timely-mobile-proposal.png",
          "/tmp/timely-mobile-failed.png",
          "/tmp/timely-mobile-bot.png",
          "/tmp/timely-mobile-bot-not-it.png",
          "/tmp/timely-mobile-bot-two.png",
          "/tmp/timely-mobile-bot-link.png",
          "/tmp/timely-mobile-bot-brief.png",
          "/tmp/timely-mobile-tag-answer.png",
          "/tmp/timely-mobile-tag-picker.png",
          "/tmp/timely-mobile-learned.png",
          "/tmp/timely-mobile-dont-learn.png",
        ],
      }),
    );
  } catch (error) {
    await page
      .screenshot({ path: "/tmp/timely-mobile-failure.png", fullPage: true })
      .catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
    process.exit();
  }
}
