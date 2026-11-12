const BAD=["幹你娘","操你媽","機掰","去死","殺了你"]; // 可自行增減
const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"Content-Type":"application/json"}});
function review(t){
  if(/(\d[\s-]?){8,}/.test(t))return"疑似含電話或長數字串";
  if(/[\w.+-]+@[\w-]+\.[\w.]+/.test(t))return"疑似含 Email";
  if(/https?:\/\/|www\./i.test(t))return"不可附網址";
  if(/@[\w.]{3,}/.test(t))return"疑似標註他人帳號";
  if(/[A-Z][12]\d{8}/i.test(t))return"疑似含身分證字號";
  if(BAD.some(w=>t.includes(w)))return"內容含不當字詞";
  return null;
}
const authed=(req,env)=>!!env.ADMIN_PASSWORD&&(req.headers.get("X-Admin-Token")||"")===env.ADMIN_PASSWORD;
async function toMake(env,p){
  const out={post_id:p.post_id,title:p.title,content:p.content,source:"USER",status:"APPROVED",options:[],
    submitted_at:p.submitted_at,image_url:p.image_url,category:p.category,nickname:p.nickname,has_image:p.has_image};
  const m=await fetch(env.WEBHOOK_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(out)});
  return m.ok;
}
export default{
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(!path.startsWith("/api/"))return env.ASSETS.fetch(req);
    if(req.method!=="POST"&&path!=="/api/admin/list")return J({error:"method"},405);
    if(!env.SUBMISSIONS||!env.WEBHOOK_URL||!env.IMGBB_KEY)return J({error:"尚未完成 Cloudflare 設定"},500);

    if(path==="/api/submit"){
      let d;try{d=await req.json()}catch{return J({error:"格式錯誤"},400)}
      const t=String(d.content||"").trim(),nk=String(d.nickname||"匿名").slice(0,12);
      if(t.length<5||t.length>500)return J({error:"字數不符"},400);
      const bad=review(t+" "+nk);if(bad)return J({error:bad},422);
      const b64=String(d.image_base64||"");
      if(!b64||b64.length>3000000)return J({error:"圖片無效或過大"},400);
      const fd=new FormData();fd.append("image",b64);
      const r=await fetch("https://api.imgbb.com/1/upload?key="+env.IMGBB_KEY,{method:"POST",body:fd});
      const jr=await r.json().catch(()=>({}));
      const image_url=(jr.data&&jr.data.url)||"";
      if(!image_url)return J({error:"圖片上傳失敗"},502);
      const id=String(d.id||"").replace(/\W/g,"").slice(0,8),ts=Date.now();
      const key="post:"+ts+"-"+id;
      const rec={key,post_id:"post-"+ts+"-"+id,title:"靠北培英 #"+id,content:t,category:String(d.category||"").slice(0,10),
        nickname:nk,has_image:!!d.has_image,image_url,delete_url:(jr.data&&jr.data.delete_url)||"",
        submitted_at:new Date(ts).toISOString(),status:"PENDING"};
      await env.SUBMISSIONS.put(key,JSON.stringify(rec));
      return J({ok:true});
    }

    if(!authed(req,env))return J({error:"unauthorized"},401);

    if(path==="/api/admin/list"){
      const l=await env.SUBMISSIONS.list({prefix:"post:",limit:200});
      const items=(await Promise.all(l.keys.map(k=>env.SUBMISSIONS.get(k.name,"json")))).filter(Boolean).reverse();
      return J({items});
    }
    if(path==="/api/admin/action"){
      let d;try{d=await req.json()}catch{return J({error:"格式錯誤"},400)}
      const key=String(d.key||""),act=d.action;
      if(!key.startsWith("post:"))return J({error:"key 無效"},400);
      if(act==="delete"){await env.SUBMISSIONS.delete(key);return J({ok:true})}
      const rec=await env.SUBMISSIONS.get(key,"json");
      if(!rec)return J({error:"找不到投稿"},404);
      if(act==="approve"){
        if(rec.status==="APPROVED")return J({error:"已核准過，不會重複發布"},409);
        if(!await toMake(env,rec))return J({error:"Make 接收失敗，投稿仍為待審"},502);
        rec.status="APPROVED";
      }else if(act==="reject"){rec.status="REJECTED"}
      else return J({error:"未知操作"},400);
      await env.SUBMISSIONS.put(key,JSON.stringify(rec));
      return J({ok:true,status:rec.status});
    }
    return J({error:"not found"},404);
  }
};
