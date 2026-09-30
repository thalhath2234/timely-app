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
  `export const useSheetsQuery=()=>({data:[]}); export const useSheetQuery=()=>({data:undefined}); export const useWorkspacesQuery=()=>({data:[]});`,
);
stub(
  "lib/chat/storage",
  "export const removeLocalImage=async()=>{}; export const retainImage=async(_uid,uri)=>uri;",
);
stub("lib/api/client", 'export const api=async()=>fetch("/receipt.jpg");');
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
 running:{id:"running",title:"Plan my week",status:"running",phase:"plan",webSearch:false,context:[],revision:1,unread:false,error:"",createdAt:iso(1),updatedAt:iso(1),plan:[],messages:[{id:"r1",role:"user",content:"Help me plan this week.",createdAt:iso(1)}]},
};
const summary=(c)=>({id:c.id,title:c.title,status:c.status,phase:c.phase,webSearch:c.webSearch,revision:c.revision,unread:c.unread,error:c.error,createdAt:c.createdAt,updatedAt:c.updatedAt});
export const uploadChatImage=async()=>({id:"photo",expiresAt:"2099-01-01"});
export const renameChat=(id,title)=>chatRequest("/"+id,"PATCH",{title});
export const deleteChat=(id)=>chatRequest("/"+id,"DELETE");
export async function chatRequest(path,method="GET",body){
 window.auditActions.push({path,method,body});
 const match=path.match(/^\\/([^/]+)(.*)$/);
 const chat=match?chats[match[1]]:undefined;
 const action=match?match[2]:"";
 if(method==="POST"&&path===""){const id="new"+Date.now();chats[id]={id,title:body.content.slice(0,70),status:"queued",phase:"plan",webSearch:body.webSearch,context:body.context||[],revision:1,unread:false,error:"",createdAt:iso(0),updatedAt:iso(0),plan:[],messages:[{id:"u",role:"user",content:body.content,createdAt:iso(0)}]};return structuredClone(chats[id]);}
 if(!path)return Object.values(chats).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(summary);
 if(!chat)throw new Error("Conversation not found");
 if(method==="DELETE"){delete chats[chat.id];return;}
 if(method==="PATCH"){Object.assign(chat,body);chat.revision++;return structuredClone(chat);}
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
    'export const useFocusEffect=()=>{};export const usePathname=()=>"/assistant";',
  "react-native-safe-area-context":
    'export {View as SafeAreaView} from "react-native";',
};
const rnStub = `export * from ${JSON.stringify(requireMobile.resolve("react-native-web"))};`;
const entry = `import React,{useState} from "react";import {createRoot} from "react-dom/client";import {QueryClient,QueryClientProvider} from "@tanstack/react-query";import Assistant from "./components/chat/Assistant";import {Context,emptyDraft} from "./lib/chat/runtime";
window.auditActions=[];
function App(){const initial=new URLSearchParams(location.search).get("chat");const [chatId,select]=useState(initial);const [cache,updateCache]=useState({receiptEdits:{},draft:emptyDraft(),chats:[],conversations:{}});const state={visible:true,foreground:true,hydrated:true,chatId,cache,updateCache,setDraft:update=>updateCache(value=>({...value,draft:update(value.draft||emptyDraft())})),acceptSend:(_old,id)=>select(id),select,currentContext:()=>[{kind:"location",label:"Current screen",value:"/tasks"},{kind:"tasks",label:"3 selected tasks",value:"[]"}],setBackHandler:()=>{},openResult:href=>{window.auditResult=href},close:()=>{window.auditClosed=true},screenshot:async()=>"/receipt.jpg"};return <QueryClientProvider client={client}><Context.Provider value={state}><Assistant/></Context.Provider></QueryClientProvider>};const client=new QueryClient({defaultOptions:{queries:{retry:false}}});createRoot(document.getElementById("root")).render(<App/>);`;
const output = await build({
  stdin: { contents: entry, resolveDir: mobile, loader: "tsx" },
  bundle: true,
  write: false,
  format: "iife",
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
    await page.getByLabel("Apply changes").waitFor();
    await page.getByLabel("Review details").nth(1).click();
    await page.getByText("Hosting").waitFor();
    await page.screenshot({
      path: "/tmp/timely-mobile-proposal.png",
      fullPage: true,
    });
    await page.getByLabel("Discard proposal").click();
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
    await page.getByLabel("Failed").waitFor();
    await page.screenshot({
      path: "/tmp/timely-mobile-failed.png",
      fullPage: true,
    });
    await page.getByLabel("Review unfinished changes").click();
    await page.getByLabel("Apply changes").waitFor();
    // Running state: stop from the composer
    await page.goto("http://localhost:4002/?chat=running");
    await page.getByText("Thinking it through…").first().waitFor();
    await page.getByLabel("Stop run").click();
    await page.getByText("Stopped. Completed changes are kept.").waitFor();
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
