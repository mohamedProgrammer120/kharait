const {encryptSecret,json,authenticate}=require("./_lib/credentials");
const allowed=["gemini","groq","openrouter","openai","anthropic"];
module.exports=async function(req,res){
 if(!["GET","POST","DELETE"].includes(req.method)){res.setHeader("Allow","GET, POST, DELETE");return json(res,405,{error:"Method not allowed"})}
 try{
  const u=await authenticate(req);if(!u)return json(res,401,{error:"Connectez-vous à Kharait."});
  if(req.method==="GET"){
   const r=await fetch(u.base+"/rest/v1/ai_credentials?select=provider&order=provider.asc",{headers:{apikey:u.pub,Authorization:u.authorization}});
   if(!r.ok)return json(res,502,{error:"Impossible de lire les clés enregistrées."});
   const rows=await r.json();return json(res,200,{providers:rows.map(x=>x.provider)});
  }
  const b=typeof req.body==="string"?JSON.parse(req.body):(req.body||{}),p=b.provider;
  if(!allowed.includes(p))return json(res,400,{error:"Fournisseur non pris en charge."});
  const url=u.base+"/rest/v1/ai_credentials?provider=eq."+encodeURIComponent(p);
  if(req.method==="DELETE"){
   const r=await fetch(url,{method:"DELETE",headers:{apikey:u.pub,Authorization:u.authorization}});
   if(!r.ok)return json(res,502,{error:"Suppression impossible."});return json(res,200,{ok:true});
  }
  if(typeof b.key!=="string"||b.key.length<12||b.key.length>500||/[\r\n]/.test(b.key))return json(res,400,{error:"Clé API invalide."});
  const secret=encryptSecret(b.key);
  const r=await fetch(u.base+"/rest/v1/ai_credentials",{method:"POST",headers:{apikey:u.pub,Authorization:u.authorization,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({user_id:u.id,provider:p,...secret,updated_at:new Date().toISOString()})});
  if(!r.ok)return json(res,502,{error:"Enregistrement impossible. Vérifiez la migration SQL Supabase."});
  return json(res,200,{ok:true,provider:p});
 }catch(e){return json(res,e.message==="CREDENTIAL_ENCRYPTION_NOT_CONFIGURED"?503:500,{error:e.message==="CREDENTIAL_ENCRYPTION_NOT_CONFIGURED"?"Le chiffrement des clés n'est pas configuré sur Vercel.":"Erreur interne de stockage des clés."})}
};
