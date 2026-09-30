// Render production mobile assistant components with fixture APIs in react-native-web.
// Camera/file access and native sheets are substituted; this does not test Android wiring.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
const root = process.cwd();
const mobile = resolve(root, "apps/mobile");
const requireMobile = createRequire(resolve(mobile, "package.json"));
const { build } = createRequire(resolve(root, "apps/web/package.json"))(
  "esbuild",
);
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
  `export const useSheetsQuery=()=>({data:[{id:"expense",title:"Expenses",tabs:[{id:"september",name:"September"}]}]}); export const useSheetQuery=()=>({data:{id:"expense",title:"Expenses",tabs:[{id:"september",name:"September"}]}}); export const useWorkspacesQuery=()=>({data:[]});`,
);
stub(
  "lib/chat/storage",
  "export const removeLocalImage=async()=>{}; export const retainImage=async(_uid,uri)=>uri;",
);
stub("lib/api/client", 'export const api=async()=>fetch("/receipt.jpg");');
stub(
  "components/docs/RichDoc",
  'import React from "react"; import {Text} from "react-native"; export default ({value})=><Text>{JSON.stringify(value)}</Text>;',
);
stub(
  "components/ui/AnimatedPressable",
  'export {Pressable as default} from "react-native";',
);
stub(
  "components/ui/BottomSheet",
  `import React from "react"; import {View,Text,Pressable} from "react-native";
export default ({open,title,children,footer,onClose})=>open?<View role="dialog" aria-label={title} style={{position:"fixed",bottom:0,left:0,right:0,backgroundColor:"#22232b",padding:20,zIndex:100,gap:12,maxHeight:"90vh",overflow:"auto"}}><Text style={{color:"white",fontSize:20}}>{title}</Text><Pressable accessibilityLabel="Close picker" onPress={onClose}><Text style={{color:"white"}}>Close</Text></Pressable>{children}{footer}</View>:null;
export const SheetOption=({children,onSelect})=><Pressable accessibilityRole="button" accessibilityLabel={children} onPress={onSelect} style={{padding:16}}><Text style={{color:"white"}}>{children}</Text></Pressable>;`,
);
stub(
  "lib/api/chat",
  `
let chat;
const draft={merchant:"業務スーパー",date:"2026-09-30",currency:"JPY",category:"groceries",subtotal:"2147",tax:"171",tip:"",discount:"",total:"2318",taxIncluded:false,issues:[],items:["179","398","398","684","248","236","4"].map((amount,i)=>({description:["コカ・コーラ","いちごとナッツ","冷凍マンゴー","チャパティ","オーガニックオート","グリコジャイアントコーン","レジ袋NO45小"][i],amount,quantity:i===3?"3":i===5?"2":"1",unitPrice:i===3?"228":i===5?"118":amount,category:""}))};
export const uploadChatImage=async()=>({id:"photo",expiresAt:"2099-01-01"});
export async function chatRequest(path,method,body){
 window.auditActions.push({path,method,body});
 if(method==="POST"&&(path===""||path.endsWith("/messages"))){
 chat={id:"receipt-chat",title:"Receipt",revision:1,status:"idle",phase:"review",webSearch:false,context:[],plan:[],messages:[],images:[{id:"photo",name:"Receipt",expiresAt:"2099-01-01"}],imageReview:{receiptId:"receipt",imageIds:["photo"],status:"review",receipt:structuredClone(draft)}};
 if(window.auditScenario==="missing-bag") chat.imageReview.receipt.items.pop();
 return structuredClone(chat);
 }
 if(!path)return chat?[structuredClone(chat)]:[];
 if(path.endsWith("/receipt")){
 chat.imageReview.receipt=body.receipt; chat.imageReview.destination=body.destination; chat.revision++;
 if(window.auditScenario==="duplicate"&&!body.destination.duplicateAction) {chat.status="idle";chat.imageReview.duplicates=[{sheetId:"expense",tabId:"september",rowId:"existing",sheetTitle:"Expenses",date:draft.date,currency:"JPY",total:"2318",itemMatch:"same"}];chat.error="A matching receipt exists. Choose Skip, Update existing, or Add anyway";}
 else {chat.status="approval";chat.plan=[{tool:"update_sheet",summary:"Add one receipt and seven items to Expenses · September",status:"pending",arguments:{sheetId:"expense",tabs:[]}}];}
 return structuredClone(chat);
 }
 if(path.endsWith("/approve")){chat.status="idle";chat.imageReview.status="confirmed";chat.plan[0].status="done";chat.plan[0].result={sheet:{id:"expense",title:"Expenses"}};return structuredClone(chat);}
 if(path.endsWith("/images/discard")){chat.imageReview.status="discarded";return structuredClone(chat);}
 return structuredClone(chat);
}`,
);
const modules = {
  "expo-clipboard": "export const getImageAsync=async()=>null;",
  "expo-image-picker":
    'export const requestCameraPermissionsAsync=async()=>({granted:true});export const launchCameraAsync=async()=>({canceled:false,assets:[{uri:"/receipt.jpg",width:1080,height:1920,fileName:"Receipt.jpg"}]});export const launchImageLibraryAsync=launchCameraAsync;',
  "expo-image-manipulator":
    'export const ImageManipulator={manipulate:()=>({resize(){},renderAsync:async()=>({saveAsync:async()=>({uri:"/receipt.jpg"})})})};export const SaveFormat={JPEG:"jpeg"};',
  "expo-document-picker":
    "export const getDocumentAsync=async()=>({canceled:true});",
  "expo-file-system/legacy":
    'export const getInfoAsync=async()=>({exists:true,size:212961});export const cacheDirectory="/";export const deleteAsync=async()=>{};export const writeAsStringAsync=async()=>{};export const EncodingType={Base64:"base64"};',
  "expo-secure-store":
    "export const getItemAsync=async()=>null;export const setItemAsync=async()=>{};",
  "expo-router":
    'export const useFocusEffect=()=>{};export const usePathname=()=>"/assistant";',
  "react-native-safe-area-context":
    'export {View as SafeAreaView} from "react-native";',
};
// RN's Alert menu is native. Expose its actual options as clickable browser buttons.
const rnStub = `export * from ${JSON.stringify(requireMobile.resolve("react-native-web"))};
export const Alert={alert:(title,message,buttons)=>{const menu=document.createElement("div");menu.setAttribute("role","dialog");menu.setAttribute("aria-label",title);menu.style="position:fixed;inset:20%;background:#222;color:white;padding:20px;z-index:200";menu.append(title);for(const item of buttons||[]){const button=document.createElement("button");button.textContent=item.text;button.onclick=()=>{menu.remove();item.onPress?.()};menu.append(button)}document.body.append(menu)}};`;
const entry = `import React,{useState} from "react";import {createRoot} from "react-dom/client";import {QueryClient,QueryClientProvider} from "@tanstack/react-query";import Assistant from "./components/chat/Assistant";import {Context,emptyDraft} from "./lib/chat/runtime";
window.auditActions=[];window.auditScenario=new URLSearchParams(location.search).get("scenario")||"balanced";
function App(){const [chatId,select]=useState(null);const [cache,updateCache]=useState({receiptEdits:{},draft:emptyDraft(),chats:[],conversations:{}});const state={visible:true,foreground:true,hydrated:true,chatId,cache,updateCache,setDraft:update=>updateCache(value=>({...value,draft:update(value.draft||emptyDraft())})),acceptSend:(_old,id)=>select(id),select,currentContext:()=>[],setBackHandler:()=>{},openResult:href=>{window.auditResult=href},close:()=>{},screenshot:async()=>"/receipt.jpg"};return <QueryClientProvider client={client}><Context.Provider value={state}><Assistant/></Context.Provider></QueryClientProvider>};const client=new QueryClient({defaultOptions:{queries:{retry:false}}});createRoot(document.getElementById("root")).render(<App/>);`;
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
const receiptPath = process.env.AUDIT_RECEIPT_IMAGE;
createServer(async (req, res) => {
  if (req.url?.startsWith("/app.js")) {
    res.setHeader("content-type", "text/javascript");
    res.end(bundle);
    return;
  }
  if (req.url === "/receipt.jpg") {
    if (receiptPath) {
      res.setHeader("content-type", "image/jpeg");
      res.end(await readFile(receiptPath));
    } else {
      res.setHeader("content-type", "image/svg+xml");
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="white"/><text x="20" y="40">Fixture receipt</text><text x="20" y="80">Total JPY 2318</text></svg>',
      );
    }
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mobile receipt flow audit</title><style>html,body,#root{margin:0;height:100%;background:#111218}#root{max-width:430px;margin:auto}button{padding:12px;margin:8px}</style><div id="root"></div><script src="/app.js"></script>',
  );
}).listen(4002, "0.0.0.0", () =>
  console.log(
    "Mobile receipt audit on :4002 (fixture APIs; native sheets substituted)",
  ),
);
