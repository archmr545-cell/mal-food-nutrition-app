const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
let me=null, diary=[], foods=[];
let passwordRecoveryPending=new URLSearchParams(location.hash.slice(1)).get("type")==="recovery";
let intakeItems=[], selectedIntakeFood=null, intakeSearchResults=[], intakeStorageKey="", intakeSearchTimer=0, intakeSearchSequence=0, dailyCalorieTarget=null;
let toastTimer=null;
const supabaseConfig=globalThis.MFN_SUPABASE_CONFIG||{};
const supabaseClient=globalThis.supabase?.createClient&&supabaseConfig.url&&supabaseConfig.anonKey
  ?globalThis.supabase.createClient(supabaseConfig.url,supabaseConfig.anonKey)
  :null;
const localTokenKey="mfn_local_auth_token";

async function localApi(url,opt={}){
  const headers=new Headers(opt.headers||{});
  headers.set("Accept","application/json");
  if(opt.body){
    headers.set("Content-Type","application/json");
  }
  const token=localStorage.getItem(localTokenKey);
  if(token)headers.set("Authorization",`Bearer ${token}`);
  const response=await fetch(new URL(url,location.href),{
    method:opt.method||"GET",
    headers,
    body:opt.body?JSON.stringify(opt.body):undefined
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===401&&!url.includes("/api/auth/login")){
      localStorage.removeItem(localTokenKey);
    }
    throw new Error(data.error||`Permintaan gagal (${response.status}).`);
  }
  if((url==="/api/auth/login"||url==="/api/auth/register")&&data.token){
    localStorage.setItem(localTokenKey,data.token);
  }
  return data;
}

function toast(msg){
  const element=$("#toast");
  if(toastTimer)clearTimeout(toastTimer);
  element.textContent=msg;
  element.classList.add("show");
  toastTimer=setTimeout(()=>{
    element.classList.remove("show");
    element.textContent="";
    toastTimer=null;
  },2800);
}
function esc(s){const d=document.createElement("div");d.textContent=s??"";return d.innerHTML}

function requireSupabase(){
  if(!supabaseClient)throw new Error("Supabase belum dikonfigurasi. Atur SUPABASE_URL dan SUPABASE_ANON_KEY, lalu bangun ulang situs. Lihat panduan di README.");
  return supabaseClient;
}
function supabaseData(result){
  if(result.error)throw new Error(result.error.message||"Permintaan database gagal.");
  return result.data;
}
function isAdminRoute(){return location.pathname.replace(/\/+$/,"").endsWith("/admin")}
function appUrl(path=""){return new URL(path,document.baseURI)}
async function currentProfile(){
  const client=requireSupabase();
  const auth=supabaseData(await client.auth.getUser());
  if(!auth.user)throw new Error("Sesi login sudah berakhir. Silakan masuk kembali.");
  const profile=supabaseData(await client.from("profiles").select("*").eq("id",auth.user.id).single());
  if(profile.status!=="active"){
    await client.auth.signOut();
    showAuth();
    throw new Error("Akun dinonaktifkan. Hubungi admin.");
  }
  return profile;
}
function flattenDiaryRow(row){
  const food=row.foods;
  return {...row,name:food.name,serving:food.serving,calories:Number(food.calories),protein:Number(food.protein),carbs:Number(food.carbs),fat:Number(food.fat)};
}
async function api(url,opt={}){
  if(!supabaseClient)return localApi(url,opt);
  const client=requireSupabase();
  const requestUrl=new URL(url,location.href);
  const route=requestUrl.pathname;
  const method=(opt.method||"GET").toUpperCase();
  const body=opt.body||{};
  if(route==="/api/auth/login"&&method==="POST"){
    const auth=supabaseData(await client.auth.signInWithPassword({email:body.email,password:body.password}));
    if(!auth.user)throw new Error("Email atau password salah.");
    const user=supabaseData(await client.from("profiles").select("*").eq("id",auth.user.id).single());
    if(user.status!=="active"){
      await client.auth.signOut();
      throw new Error("Akun dinonaktifkan. Hubungi admin.");
    }
    return {user};
  }
  if(route==="/api/auth/register"&&method==="POST"){
    const auth=supabaseData(await client.auth.signUp({
      email:body.email,
      password:body.password,
      options:{data:{name:body.name,birth_day:Number(body.birthDay),birth_month:Number(body.birthMonth),birth_year:Number(body.birthYear)}}
    }));
    if(!auth.user)throw new Error("Pendaftaran belum berhasil. Periksa kembali data dan email.");
    if(!auth.session)return {confirmationRequired:true};
    const user=supabaseData(await client.from("profiles").select("*").eq("id",auth.user.id).single());
    return {user};
  }
  if(route==="/api/auth/forgot-password"&&method==="POST"){
    supabaseData(await client.rpc("submit_password_report",{p_email:body.email,p_message:body.message}));
    return {message:"Permintaan bantuan sudah dikirim. Admin akan mengirim link reset password ke emailmu."};
  }
  if(route==="/api/profile/password"&&method==="POST"){
    const user=await currentProfile();
    if(!body.currentPassword||!body.password)throw new Error("Isi password saat ini dan password baru.");
    const verified=supabaseData(await client.auth.signInWithPassword({email:user.email,password:body.currentPassword}));
    if(!verified.user)throw new Error("Password saat ini salah.");
    supabaseData(await client.auth.updateUser({password:body.password}));
    await client.auth.signOut();
    return {message:"Password berhasil diganti. Silakan login kembali."};
  }
  if(route==="/api/auth/me"){
    const user=await currentProfile();
    if(method==="PATCH"){
      const updated=supabaseData(await client.from("profiles").update({name:String(body.name||"").trim()}).eq("id",user.id).select("*").single());
      return {user:updated};
    }
    return user;
  }
  if(route==="/api/profile"&&method==="PATCH"){
    const user=await currentProfile();
    const updated=supabaseData(await client.from("profiles").update({name:String(body.name||"").trim()}).eq("id",user.id).select("*").single());
    return {user:updated};
  }
  if(route==="/api/foods"&&method==="GET"){
    await currentProfile();
    let query=client.from("foods").select("*").order("name");
    const search=requestUrl.searchParams.get("search")?.trim();
    if(search)query=query.ilike("name",`%${search}%`);
    return supabaseData(await query);
  }
  if(route==="/api/diary"&&method==="GET"){
    const user=await currentProfile();
    const rows=supabaseData(await client.from("diary").select("id,amount,created_at,food_id,foods!inner(name,serving,calories,protein,carbs,fat)").eq("user_id",user.id).order("created_at",{ascending:false}));
    return rows.map(flattenDiaryRow);
  }
  if(route==="/api/diary"&&method==="POST"){
    const user=await currentProfile();
    const amount=Number(body.amount);
    if(!Number.isFinite(amount)||amount<=0||amount>100)throw new Error("Jumlah porsi tidak valid.");
    const result=supabaseData(await client.from("diary").insert({user_id:user.id,food_id:Number(body.foodId),amount}).select("id").single());
    return {id:result.id};
  }
  const diaryId=route.match(/^\/api\/diary\/(\d+)$/);
  if(diaryId&&method==="DELETE"){
    const user=await currentProfile();
    supabaseData(await client.from("diary").delete().eq("id",Number(diaryId[1])).eq("user_id",user.id));
    return {message:"Diary dihapus."};
  }
  if(route==="/api/admin/stats"){
    await currentProfile();
    return supabaseData(await client.rpc("get_admin_stats"));
  }
  if(route==="/api/admin/users"&&method==="GET"){
    await currentProfile();
    return supabaseData(await client.rpc("list_admin_users",{p_search:requestUrl.searchParams.get("search")||""}));
  }
  if(route==="/api/admin/admins"&&method==="GET"){
    await currentProfile();
    return supabaseData(await client.from("profiles").select("id,name,email,status,created_at").eq("role","admin").order("name"));
  }
  const reportResolve=route.match(/^\/api\/admin\/password-reports\/(\d+)\/resolve$/);
  if(reportResolve&&method==="POST"){
    await currentProfile();
    supabaseData(await client.rpc("resolve_password_report",{p_report_id:Number(reportResolve[1])}));
    return {message:"Laporan ditandai selesai."};
  }
  if(route==="/api/admin/password-reports"&&method==="GET"){
    await currentProfile();
    const rows=supabaseData(await client.from("password_reports").select("id,email,message,status,created_at,resolved_at,user:profiles(name)").order("created_at",{ascending:false}));
    return rows.map(row=>({...row,name:row.user?.name||null}));
  }
  const reportReset=route.match(/^\/api\/admin\/password-reports\/(\d+)\/reset$/);
  if(reportReset&&method==="POST"){
    await currentProfile();
    const report=supabaseData(await client.from("password_reports").select("email").eq("id",Number(reportReset[1])).single());
    supabaseData(await client.auth.resetPasswordForEmail(report.email,{redirectTo:appUrl("index.html#reset-password").href}));
    return {message:"Link reset password sudah dikirim ke email laporan."};
  }
  const userReset=route.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
  if(userReset&&method==="POST"){
    await currentProfile();
    const user=supabaseData(await client.from("profiles").select("email").eq("id",userReset[1]).single());
    supabaseData(await client.auth.resetPasswordForEmail(user.email,{redirectTo:appUrl("index.html#reset-password").href}));
    return {message:"Link reset password sudah dikirim ke email user."};
  }
  const userStatus=route.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if(userStatus&&method==="PATCH"){
    await currentProfile();
    supabaseData(await client.rpc("set_user_status",{p_user_id:userStatus[1],p_status:body.status}));
    return {message:"Status user diperbarui."};
  }
  const adminUser=route.match(/^\/api\/admin\/users\/([^/]+)$/);
  if(adminUser&&method==="GET"){
    await currentProfile();
    const user=supabaseData(await client.from("profiles").select("id,name,email,birth_day,birth_month,birth_year,role,status,created_at").eq("id",adminUser[1]).single());
    const entries=supabaseData(await client.from("diary").select("id,amount,created_at,foods!inner(name,calories,protein,carbs,fat)").eq("user_id",user.id).order("created_at",{ascending:false}));
    return {user,diary:entries.map(row=>({...row,...row.foods}))};
  }
  const foodEdit=route.match(/^\/api\/admin\/foods\/(\d+)$/);
  if(route==="/api/admin/foods"&&method==="POST"){
    await currentProfile();
    return supabaseData(await client.from("foods").insert(body).select("id").single());
  }
  if(foodEdit&&method==="PUT"){
    await currentProfile();
    return supabaseData(await client.from("foods").update(body).eq("id",Number(foodEdit[1])).select("id").single());
  }
  if(foodEdit&&method==="DELETE"){
    await currentProfile();
    const result=await client.from("foods").delete().eq("id",Number(foodEdit[1]));
    if(result.error?.code==="23503")throw new Error("Makanan sudah dipakai di diary dan tidak bisa dihapus.");
    return supabaseData(result);
  }
  throw new Error(`Operasi ${method} ${route} tidak didukung.`);
}
function recordSiteVisit(){
  try{
    const visitorKey="mfn_visitor_id";
    const sessionKey="mfn_visit_session";
    let visitorId=localStorage.getItem(visitorKey);
    if(!visitorId){visitorId=crypto.randomUUID();localStorage.setItem(visitorKey,visitorId)}
    if(sessionStorage.getItem(sessionKey))return;
    const sessionId=crypto.randomUUID();
    sessionStorage.setItem(sessionKey,sessionId);
    const request=supabaseClient
      ?supabaseClient.rpc("record_site_visit",{p_visitor_id:visitorId,p_session_id:sessionId,p_page_path:location.pathname})
      :localApi("/api/visits",{method:"POST",body:{visitorId,sessionId,pagePath:location.pathname}});
    Promise.resolve(request).then(result=>{
      const error=result?.error;
      if(error)console.error("Gagal mencatat kunjungan:",error.message);
    }).catch(error=>console.error("Gagal mencatat kunjungan:",error));
  }catch(error){
    console.error("Gagal menyiapkan statistik kunjungan:",error);
  }
}

const healthyRecipes=[
  {name:"Overnight oats pisang",emoji:"🥣",category:"Sarapan",time:10,calories:320,protein:13,description:"Sarapan praktis yang disiapkan dari malam sebelumnya.",ingredients:["5 sdm rolled oats","150 ml susu rendah lemak","1/2 buah pisang","1 sdt chia seed"],steps:["Campur oats, susu, dan chia seed dalam wadah tertutup.","Simpan di kulkas minimal 4 jam atau semalaman.","Tambahkan irisan pisang sebelum disajikan."]},
  {name:"Telur orak-arik sayur",emoji:"🍳",category:"Sarapan",time:15,calories:260,protein:19,description:"Telur dan sayuran untuk sarapan gurih dan mengenyangkan.",ingredients:["2 butir telur","1 genggam bayam","1/2 buah tomat","1 sdt minyak zaitun"],steps:["Kocok telur, lalu bumbui secukupnya.","Tumis tomat dan bayam dengan sedikit minyak sampai layu.","Masukkan telur dan aduk perlahan sampai matang."]},
  {name:"Roti gandum alpukat telur",emoji:"🥑",category:"Sarapan",time:12,calories:350,protein:16,description:"Roti gandum dengan lemak baik, serat, dan protein.",ingredients:["2 lembar roti gandum","1/2 buah alpukat","1 butir telur","Perasan jeruk nipis"],steps:["Panggang roti hingga hangat.","Haluskan alpukat dengan sedikit jeruk nipis.","Masak telur sesuai selera, lalu sajikan di atas roti beroles alpukat."]},
  {name:"Yogurt bowl buah",emoji:"🍓",category:"Sarapan",time:8,calories:280,protein:15,description:"Semangkuk yogurt, buah segar, dan kacang untuk pagi yang ringan.",ingredients:["150 g yogurt tawar","1/2 buah apel","1/2 buah pisang","1 sdm kacang almond"],steps:["Tuang yogurt tawar ke mangkuk.","Potong buah lalu susun di atas yogurt.","Taburi almond. Pilih yogurt tanpa gula tambahan."]},
  {name:"Salad ayam panggang",emoji:"🥗",category:"Makan siang",time:25,calories:390,protein:35,description:"Sayuran renyah dan ayam panggang dengan saus sederhana.",ingredients:["120 g dada ayam","2 genggam selada","1/2 buah mentimun","5 buah tomat ceri","1 sdm yogurt tawar dan perasan lemon"],steps:["Panggang ayam dengan lada dan sedikit garam sampai matang, lalu iris.","Campur selada, mentimun, dan tomat dalam mangkuk.","Aduk yogurt dengan lemon sebagai saus, lalu sajikan bersama ayam."]},
  {name:"Gado-gado saus kacang ringan",emoji:"🥜",category:"Makan siang",time:25,calories:410,protein:20,description:"Sayuran, tahu, dan telur dengan saus kacang secukupnya.",ingredients:["100 g tahu kukus","1 butir telur rebus","1 genggam kangkung","50 g tauge","1 sdm selai kacang tanpa gula, air jeruk nipis, dan air"],steps:["Rebus kangkung dan tauge sebentar, tiriskan.","Campur selai kacang dengan jeruk nipis dan air sampai menjadi saus.","Sajikan sayuran bersama tahu dan telur, lalu tambahkan saus secukupnya."]},
  {name:"Nasi merah ayam dan sayur",emoji:"🍚",category:"Makan siang",time:30,calories:460,protein:34,description:"Menu seimbang berisi karbohidrat kompleks, protein, dan sayur.",ingredients:["150 g nasi merah matang","100 g dada ayam","1 genggam brokoli","1/2 buah wortel","1 sdt minyak"],steps:["Panggang atau rebus ayam hingga matang, lalu iris.","Kukus brokoli dan wortel hingga empuk tetapi tetap renyah.","Sajikan bersama nasi merah. Gunakan bumbu secukupnya."]},
  {name:"Tuna wrap sayuran",emoji:"🌯",category:"Makan siang",time:15,calories:370,protein:27,description:"Wrap praktis berisi tuna, sayur, dan saus yogurt.",ingredients:["1 lembar tortilla gandum","80 g tuna dalam air, tiriskan","1 genggam selada","1/2 buah mentimun","1 sdm yogurt tawar"],steps:["Campur tuna dengan yogurt tawar.","Letakkan selada, mentimun, dan tuna di atas tortilla.","Gulung rapat dan potong menjadi dua."]},
  {name:"Ikan panggang dan sayur",emoji:"🐟",category:"Makan malam",time:25,calories:340,protein:32,description:"Ikan panggang dengan sayuran, tanpa perlu banyak minyak.",ingredients:["120 g fillet ikan","1/2 buah lemon","1 genggam buncis","1/2 buah wortel","1 sdt minyak zaitun"],steps:["Bumbui ikan dengan lemon, lada, dan sedikit garam.","Panggang ikan selama 12–15 menit sampai matang.","Kukus buncis dan wortel, lalu sajikan bersama ikan."]},
  {name:"Sup ayam bening",emoji:"🍲",category:"Makan malam",time:35,calories:300,protein:28,description:"Sup hangat berisi ayam tanpa kulit dan aneka sayur.",ingredients:["100 g dada ayam tanpa kulit","1 buah wortel","1 genggam kol","1 batang daun bawang","500 ml air"],steps:["Rebus ayam sampai matang dan buang buih yang muncul.","Masukkan wortel dan masak sampai mulai empuk.","Tambahkan kol dan daun bawang, lalu bumbui ringan sebelum disajikan."]},
  {name:"Tumis tahu brokoli",emoji:"🥦",category:"Makan malam",time:20,calories:310,protein:21,description:"Tahu dan brokoli dimasak cepat dengan sedikit minyak.",ingredients:["150 g tahu, potong dadu","1 genggam brokoli","1 siung bawang putih","1 sdt minyak","2 sdm air"],steps:["Tumis bawang putih dengan sedikit minyak sampai harum.","Masukkan tahu dan brokoli, lalu tambahkan air.","Masak sampai brokoli matang dan air menyusut."]},
  {name:"Tempe panggang bumbu kunyit",emoji:"🟨",category:"Makan malam",time:25,calories:330,protein:22,description:"Tempe panggang kaya protein nabati, cocok dengan sayur segar.",ingredients:["120 g tempe","1/2 sdt kunyit","1 siung bawang putih","1 genggam lalapan"],steps:["Haluskan bawang putih dan kunyit dengan sedikit air.","Balurkan bumbu ke tempe dan diamkan 10 menit.","Panggang tempe sampai kecokelatan, lalu sajikan bersama lalapan."]},
  {name:"Edamame rebus",emoji:"🫛",category:"Camilan",time:10,calories:190,protein:17,description:"Camilan sederhana tinggi protein dan serat.",ingredients:["150 g edamame polong","Air secukupnya","Sejumput garam (opsional)"],steps:["Didihkan air dalam panci.","Rebus edamame selama 4–5 menit.","Tiriskan dan tambahkan sedikit garam jika suka."]},
  {name:"Smoothie mangga yogurt",emoji:"🥭",category:"Camilan",time:5,calories:220,protein:11,description:"Minuman buah segar tanpa tambahan gula.",ingredients:["100 g mangga matang","120 g yogurt tawar","50 ml air dingin","Es batu secukupnya"],steps:["Masukkan mangga, yogurt, air, dan es ke blender.","Blender sampai halus.","Sajikan segera tanpa tambahan gula."]}
];

const extraRecipeRows=[
  ["Bubur oat apel kayu manis","🥣","Sarapan",290,10,["50 g rolled oats","1 buah apel kecil, potong dadu","200 ml susu rendah lemak","1/4 sdt kayu manis"],"Rebus"],
  ["Pancake oat pisang","🥞","Sarapan",310,14,["40 g oat halus","1 buah pisang matang","1 butir telur","1/2 sdt baking powder"],"Wajan"],
  ["Omelet jamur bayam","🍳","Sarapan",270,20,["2 butir telur","50 g jamur iris","1 genggam bayam","1 sdt minyak zaitun"],"Wajan"],
  ["Omelet tomat paprika","🍅","Sarapan",250,18,["2 butir telur","1/2 buah tomat","1/4 buah paprika","1 sdt minyak"],"Wajan"],
  ["Sandwich tuna sayur","🥪","Sarapan",340,24,["2 lembar roti gandum","70 g tuna dalam air","2 lembar selada","1 sdm yogurt tawar"],"Sajikan dingin"],
  ["Smoothie bowl berry oats","🫐","Sarapan",330,14,["100 g stroberi dan blueberry","120 g yogurt tawar","30 g rolled oats","1 sdt chia seed"],"Blender"],
  ["Chia pudding mangga","🥭","Sarapan",280,10,["2 sdm biji chia","180 ml susu kedelai tanpa gula","100 g mangga potong","1 sdt kelapa parut"],"Dinginkan"],
  ["Bubur kacang hijau santan ringan","🥣","Sarapan",300,12,["50 g kacang hijau kering","250 ml air","50 ml susu rendah lemak","Jahe dan sedikit gula aren"],"Rebus"],
  ["Ubi kukus telur rebus","🍠","Sarapan",290,14,["150 g ubi jalar","2 butir telur","1 genggam tomat ceri","Lada hitam secukupnya"],"Kukus"],
  ["Nasi merah telur sayur","🍚","Sarapan",370,17,["120 g nasi merah matang","1 butir telur","1/2 wortel parut","1 genggam bayam"],"Tumis"],
  ["Tahu scramble roti gandum","🍞","Sarapan",350,20,["100 g tahu, hancurkan","2 lembar roti gandum","1/2 sdt kunyit","1 batang daun bawang"],"Tumis"],
  ["Wrap telur bayam","🌯","Sarapan",330,21,["1 lembar tortilla gandum","2 butir telur","1 genggam bayam","1 sdm yogurt tawar"],"Wajan"],
  ["Yogurt pepaya chia","🍈","Sarapan",240,13,["150 g yogurt tawar","120 g pepaya potong","1 sdt biji chia","10 g kacang almond"],"Sajikan dingin"],
  ["Roti gandum cottage cheese tomat","🍅","Sarapan",300,19,["2 lembar roti gandum","60 g cottage cheese rendah lemak","1 buah tomat","Oregano kering secukupnya"],"Panggang"],
  ["Bubur quinoa pir","🍐","Sarapan",310,11,["50 g quinoa","150 ml susu rendah lemak","1/2 buah pir potong","Sejumput kayu manis"],"Rebus"],
  ["Telur panggang paprika","🫑","Sarapan",260,19,["2 butir telur","1 buah paprika kecil","2 sdm tomat cincang","Lada hitam secukupnya"],"Panggang"],
  ["Oat gurih ayam bayam","🥣","Sarapan",350,25,["45 g rolled oats","60 g dada ayam suwir","1 genggam bayam","250 ml kaldu rendah garam"],"Rebus"],
  ["Pancake yogurt stroberi","🥞","Sarapan",320,15,["40 g tepung oat","1 butir telur","80 g yogurt tawar","5 buah stroberi"],"Wajan"],
  ["Roti panggang pisang selai kacang","🍌","Sarapan",310,12,["2 lembar roti gandum","1/2 buah pisang","1 sdm selai kacang tanpa gula","Sejumput kayu manis"],"Panggang"],
  ["Salad buah yogurt kacang","🍓","Sarapan",270,12,["100 g apel dan pepaya potong","100 g yogurt tawar","10 g kacang kenari","1 sdt biji chia"],"Sajikan dingin"],
  ["Bowl ayam teriyaki rendah garam","🍱","Makan siang",450,34,["100 g dada ayam potong","1 genggam brokoli dan wortel","130 g nasi merah matang","1 sdm kecap rendah sodium dan jahe"],"Tumis"],
  ["Soto ayam bening","🍲","Makan siang",390,30,["100 g dada ayam suwir","1 genggam kol dan tauge","100 g nasi matang","Kunyit, serai, dan kaldu rendah garam"],"Rebus"],
  ["Pepes ikan kemangi","🐟","Makan siang",350,32,["120 g fillet ikan","1 buah tomat dan daun kemangi","120 g nasi merah matang","Bawang merah, bawang putih, kunyit"],"Kukus"],
  ["Bowl tempe quinoa","🌱","Makan siang",440,23,["100 g tempe panggang","1 genggam selada dan tomat","100 g quinoa matang","1 sdm saus yogurt lemon"],"Panggang"],
  ["Sup lentil sayuran","🥕","Makan siang",360,19,["100 g lentil matang","1 buah wortel dan 1 batang seledri","1 lembar roti gandum","Tomat cincang dan lada"],"Rebus"],
  ["Nasi merah ikan kembung","🐟","Makan siang",460,31,["100 g ikan kembung","1 genggam lalapan","120 g nasi merah matang","Jeruk nipis dan kunyit"],"Panggang"],
  ["Gulai tahu santan ringan","🍛","Makan siang",390,20,["150 g tahu","1 genggam kacang panjang","100 g nasi merah matang","50 ml santan encer dan kunyit"],"Rebus"],
  ["Pasta gandum saus tomat tuna","🍝","Makan siang",440,29,["120 g pasta gandum matang","70 g tuna dalam air","100 g tomat cincang dan bayam","Bawang putih dan oregano"],"Tumis"],
  ["Burrito bowl kacang hitam","🌯","Makan siang",430,19,["80 g kacang hitam matang","1 genggam selada dan paprika","100 g nasi cokelat matang","Jeruk nipis dan ketumbar"],"Sajikan dingin"],
  ["Soba ayam mentimun","🍜","Makan siang",410,29,["100 g dada ayam rebus","100 g mi soba matang","1/2 mentimun iris","Jahe dan kecap rendah sodium"],"Rebus"],
  ["Urap sayur kelapa ringan","🥬","Makan siang",340,14,["100 g tahu kukus","1 genggam kacang panjang dan tauge","100 g nasi merah matang","1 sdm kelapa parut dan kencur"],"Kukus"],
  ["Nasi jagung ayam suwir","🌽","Makan siang",420,31,["100 g dada ayam suwir","1 genggam labu siam dan wortel","120 g nasi jagung matang","Bawang putih dan daun jeruk"],"Kukus"],
  ["Salad quinoa buncis","🥗","Makan siang",370,16,["100 g quinoa matang","80 g buncis rebus","1 buah tomat dan mentimun","Lemon dan 1 sdt minyak zaitun"],"Sajikan dingin"],
  ["Sandwich salmon yogurt","🥪","Makan siang",390,28,["80 g salmon panggang","2 lembar roti gandum","2 lembar selada dan mentimun","1 sdm yogurt tawar dan lemon"],"Panggang"],
  ["Sup miso tahu jamur","🍜","Makan siang",320,19,["100 g tahu","80 g jamur dan wakame","100 g nasi merah matang","1 sdt pasta miso rendah sodium"],"Rebus"],
  ["Bowl udang alpukat","🥑","Makan siang",430,28,["100 g udang rebus","1/4 buah alpukat dan selada","120 g quinoa matang","Jeruk nipis dan lada"],"Sajikan dingin"],
  ["Ayam panggang lemon kentang","🍗","Makan siang",460,35,["100 g dada ayam","120 g kentang dan brokoli","1 sdt minyak zaitun","Lemon, bawang putih, dan rosemary"],"Panggang"],
  ["Tahu lada hitam dengan nasi merah","🧊","Makan siang",400,22,["150 g tahu potong dadu","1 genggam paprika dan buncis","120 g nasi merah matang","Lada hitam dan kecap rendah sodium"],"Tumis"],
  ["Gado-gado edamame","🥗","Makan siang",390,22,["70 g edamame dan 1 butir telur","1 genggam kangkung dan tauge","100 g kentang rebus","1 sdm saus kacang encer"],"Rebus"],
  ["Ikan nila sambal tomat segar","🐟","Makan siang",380,31,["120 g ikan nila","1 buah tomat dan selada","120 g nasi merah matang","Cabai, jeruk limau, dan bawang merah"],"Panggang"],
  ["Bowl ayam kunyit ubi","🍠","Makan siang",430,33,["100 g dada ayam","100 g brokoli dan wortel","120 g ubi jalar kukus","Kunyit, lada, dan bawang putih"],"Panggang"],
  ["Sup kacang merah bayam","🥣","Makan siang",350,18,["100 g kacang merah matang","1 genggam bayam dan tomat","1 lembar roti gandum","Bawang putih dan lada"],"Rebus"],
  ["Wrap falafel panggang","🧆","Makan siang",420,17,["3 buah falafel panggang","1 lembar tortilla gandum","Selada, tomat, dan mentimun","2 sdm saus yogurt tahini"],"Panggang"],
  ["Tumis sapi brokoli","🥩","Makan siang",440,30,["90 g daging sapi tanpa lemak","1 genggam brokoli dan paprika","120 g nasi merah matang","Jahe dan kecap rendah sodium"],"Tumis"],
  ["Pepes tahu jamur","🍄","Makan siang",360,22,["120 g tahu dan 50 g jamur","1 genggam kemangi dan tomat","100 g nasi merah matang","Bawang merah, bawang putih, dan cabai"],"Kukus"],
  ["Sup tomat telur kacang arab","🍅","Makan siang",370,19,["1 butir telur dan 70 g kacang arab","150 g tomat dan bayam","1 lembar roti gandum","Paprika bubuk dan lada"],"Rebus"],
  ["Salad kentang telur yogurt","🥔","Makan siang",360,18,["120 g kentang dan 1 butir telur","Mentimun dan selada secukupnya","2 sdm yogurt tawar","Mustard dan lada hitam"],"Rebus"],
  ["Ayam kukus jahe pakcoy","🍗","Makan malam",350,34,["110 g dada ayam","1 bonggol pakcoy","100 g nasi merah matang","Jahe, bawang putih, dan kecap rendah sodium"],"Kukus"],
  ["Sup ikan kakap tomat","🍲","Makan malam",330,30,["120 g fillet kakap","1 buah tomat dan 1 genggam bayam","100 g kentang potong","Serai, jeruk nipis, dan lada"],"Rebus"],
  ["Tumis udang buncis bawang putih","🍤","Makan malam",340,29,["100 g udang kupas","100 g buncis dan wortel","100 g nasi cokelat matang","Bawang putih dan sedikit minyak"],"Tumis"],
  ["Salmon panggang dill","🐟","Makan malam",420,32,["100 g fillet salmon","1 genggam asparagus dan tomat","100 g kentang kukus","Lemon, dill, dan lada"],"Panggang"],
  ["Tahu kukus saus jahe","🧊","Makan malam",320,22,["150 g tahu sutra","1 genggam jamur dan pakcoy","100 g nasi merah matang","Jahe parut, daun bawang, dan kecap rendah sodium"],"Kukus"],
  ["Sup jamur barley","🍄","Makan malam",340,13,["100 g jamur campur","1 batang seledri dan 1 wortel","80 g barley matang","Bawang bombai dan kaldu rendah garam"],"Rebus"],
  ["Ayam bakar bumbu serai","🍗","Makan malam",410,34,["100 g dada ayam","1 genggam lalapan dan timun","120 g nasi merah matang","Serai, bawang putih, ketumbar, dan jeruk nipis"],"Panggang"],
  ["Tempe tumis kacang panjang","🌱","Makan malam",390,22,["100 g tempe potong","100 g kacang panjang","100 g nasi merah matang","Bawang putih dan sedikit kecap rendah sodium"],"Tumis"],
  ["Sup tahu rumput laut","🍲","Makan malam",300,20,["120 g tahu sutra","5 g wakame kering dan jamur","100 g nasi merah matang","Jahe dan kaldu rendah garam"],"Rebus"],
  ["Nila kukus jeruk nipis","🐟","Makan malam",350,32,["120 g fillet nila","1 genggam brokoli dan wortel","100 g ubi jalar kukus","Jeruk nipis, jahe, dan lada"],"Kukus"],
  ["Sate ayam panggang saus yogurt","🍢","Makan malam",400,35,["100 g dada ayam potong dadu","1 genggam paprika dan bawang bombai","100 g nasi merah matang","Yogurt tawar, kunyit, dan ketumbar"],"Panggang"],
  ["Capcay tahu kuah","🥬","Makan malam",330,19,["100 g tahu","Brokoli, wortel, kol, dan jamur","100 g nasi cokelat matang","Bawang putih dan kaldu rendah sodium"],"Tumis"],
  ["Dada kalkun panggang ubi","🍗","Makan malam",390,33,["100 g dada kalkun","1 genggam buncis dan tomat","120 g ubi jalar kukus","Paprika bubuk dan rosemary"],"Panggang"],
  ["Lentil kari santan encer","🍛","Makan malam",380,19,["100 g lentil matang","1 genggam bayam dan tomat","100 g nasi merah matang","Kari bubuk dan 40 ml santan encer"],"Rebus"],
  ["Tumis cumi paprika","🦑","Makan malam",340,25,["100 g cumi bersih","1 buah paprika dan 1 genggam pakcoy","100 g quinoa matang","Bawang putih dan lada"],"Tumis"],
  ["Frittata brokoli panggang","🍳","Makan malam",330,24,["2 butir telur","80 g brokoli dan jamur","1 lembar roti gandum","Susu rendah lemak dan lada"],"Panggang"],
  ["Bowl sarden tomat","🐟","Makan malam",410,28,["80 g sarden segar panggang","1 buah tomat dan selada","100 g nasi merah matang","Bawang merah, lemon, dan kemangi"],"Panggang"],
  ["Sup ayam quinoa","🍜","Makan malam",370,30,["80 g dada ayam","1 genggam wortel dan seledri","50 g quinoa kering","Bawang putih dan kaldu rendah garam"],"Rebus"],
  ["Terong panggang saus tahini","🍆","Makan malam",360,13,["150 g terong","1 buah tomat dan peterseli","100 g quinoa matang","1 sdm tahini dan lemon"],"Panggang"],
  ["Bowl tempe edamame","🥗","Makan malam",430,27,["70 g tempe dan 40 g edamame","1 genggam selada dan mentimun","100 g nasi merah matang","Lemon dan wijen"],"Panggang"],
  ["Ikan gurame bakar kunyit","🐟","Makan malam",390,30,["120 g fillet gurame","1 genggam lalapan","100 g jagung rebus","Kunyit, bawang putih, dan jeruk nipis"],"Panggang"],
  ["Sup sayur kacang arab","🥕","Makan malam",350,16,["80 g kacang arab matang","Wortel, tomat, dan bayam","1 lembar roti gandum","Jintan dan kaldu rendah garam"],"Rebus"],
  ["Salad soba tahu wijen","🍜","Makan malam",380,21,["100 g tahu panggang","100 g mi soba matang","Kol ungu dan mentimun","Wijen dan saus kedelai rendah sodium"],"Sajikan dingin"],
  ["Pisang panggang kayu manis","🍌","Camilan",150,2,["1 buah pisang","1/4 sdt kayu manis","1 sdt kacang cincang","Tanpa gula tambahan"],"Panggang"],
  ["Apel dan selai kacang","🍎","Camilan",190,5,["1 buah apel, iris","1 sdm selai kacang tanpa gula","Sejumput kayu manis","Sajikan segar"],"Sajikan dingin"],
  ["Hummus wortel dan mentimun","🥕","Camilan",180,6,["50 g hummus","1 buah wortel, potong stik","1/2 mentimun, potong stik","Paprika bubuk secukupnya"],"Sajikan dingin"],
  ["Kacang arab panggang rempah","🧆","Camilan",210,10,["100 g kacang arab matang","1/2 sdt paprika bubuk","1/2 sdt minyak zaitun","Lada dan jintan"],"Panggang"],
  ["Puding chia cokelat pisang","🍫","Camilan",230,9,["2 sdm biji chia","150 ml susu kedelai tanpa gula","1 sdt kakao tanpa gula","1/2 buah pisang"],"Dinginkan"],
  ["Edamame lemon lada","🫛","Camilan",170,16,["120 g edamame polong","Perasan 1/2 buah lemon","Lada hitam secukupnya","Air untuk merebus"],"Rebus"],
  ["Smoothie stroberi pisang","🍓","Camilan",210,9,["80 g stroberi","1/2 buah pisang","120 g yogurt tawar","Es batu secukupnya"],"Blender"],
  ["Pir panggang yogurt","🍐","Camilan",180,8,["1 buah pir kecil","80 g yogurt tawar","Sejumput kayu manis","1 sdt biji labu"],"Panggang"],
  ["Kacang almond panggang kayu manis","🥜","Camilan",170,6,["25 g kacang almond","Sejumput kayu manis","Sejumput garam","Panggang tanpa minyak"],"Panggang"],
  ["Jagung rebus jeruk nipis","🌽","Camilan",120,4,["1 tongkol jagung sedang","Perasan jeruk nipis","Lada bubuk secukupnya","Air untuk merebus"],"Rebus"],
  ["Yogurt blueberry biji labu","🫐","Camilan",200,14,["120 g yogurt Yunani tawar","50 g blueberry","1 sdm biji labu","Tanpa gula tambahan"],"Sajikan dingin"],
  ["Tomat isi tuna panggang","🍅","Camilan",190,17,["1 buah tomat besar","50 g tuna dalam air","1 sdm yogurt tawar","Oregano kering secukupnya"],"Panggang"],
  ["Keripik kale panggang","🥬","Camilan",100,4,["2 genggam daun kale","1 sdt minyak zaitun","Bubuk bawang putih secukupnya","Panggang sampai renyah"],"Panggang"],
  ["Telur rebus lada paprika","🥚","Camilan",140,13,["2 butir telur","Paprika bubuk secukupnya","Lada hitam secukupnya","Air untuk merebus"],"Rebus"],
  ["Smoothie mangga bayam","🥭","Camilan",190,8,["80 g mangga","1 genggam bayam","120 ml susu kedelai tanpa gula","Es batu secukupnya"],"Blender"],
  ["Puding yogurt pepaya","🍈","Camilan",180,10,["100 g pepaya","100 g yogurt tawar","1 sdt gelatin tanpa gula","Air hangat secukupnya"],"Dinginkan"]
];

const recipeCookingSteps={
  "Panggang":["Panaskan oven atau wajan panggang. Panggang bahan utama dan bumbu sampai matang, balik sesekali.","Siapkan bahan pendamping sesuai daftar dan masak hingga empuk.","Sajikan selagi hangat. Sesuaikan garam dan saus secukupnya."],
  "Tumis":["Panaskan sedikit minyak atau air, lalu tumis bumbu sampai harum.","Masukkan bahan utama dan sayuran, aduk sampai matang merata.","Sajikan bersama pelengkap yang tercantum."],
  "Rebus":["Didihkan air atau kaldu, lalu masukkan bahan utama dan bumbu.","Tambahkan sayuran atau bahan lain dan masak sampai empuk serta matang.","Sajikan hangat; koreksi rasa dengan sedikit bumbu."],
  "Kukus":["Didihkan air kukusan dan bumbui bahan utama sesuai daftar.","Kukus bahan utama sampai matang, tambahkan sayuran pada waktu yang sesuai agar tidak terlalu lembek.","Sajikan bersama pelengkap yang tercantum."],
  "Wajan":["Campur bahan sesuai daftar; haluskan atau kocok bila diperlukan.","Masak di wajan antilengket dengan sedikit minyak menggunakan api kecil-sedang sampai matang.","Sajikan hangat dengan pelengkap yang tercantum."],
  "Blender":["Masukkan seluruh bahan ke blender; tambahkan air atau es secukupnya.","Blender sampai halus dan teksturnya sesuai selera.","Sajikan segera tanpa tambahan gula."],
  "Dinginkan":["Campur bahan utama dan cairan hingga merata dalam wadah tertutup.","Simpan di kulkas minimal 2 jam atau sampai teksturnya siap disajikan.","Tambahkan buah atau taburan sebelum disantap."],
  "Sajikan dingin":["Masak atau siapkan bahan yang perlu matang, lalu dinginkan.","Potong bahan pendamping dan campur saus sesuai daftar.","Tata dalam mangkuk dan sajikan dingin."],
  "default":["Siapkan dan campur bahan utama dengan bumbu sesuai daftar.","Masak menggunakan sedikit minyak atau air sampai matang; aduk sesekali agar tidak gosong.","Sajikan selagi hangat."]
};

const recipeCookingTimes={"Panggang":25,"Tumis":20,"Rebus":25,"Kukus":20,"Wajan":15,"Blender":5,"Dinginkan":10,"Sajikan dingin":10};

healthyRecipes.push(...extraRecipeRows.map(([name,emoji,category,calories,protein,ingredients,method])=>({
  name,emoji,category,time:recipeCookingTimes[method]||20,calories,protein,
  description:`Menu ${category.toLocaleLowerCase("id")} praktis dengan bahan bergizi dan bumbu secukupnya.`,
  ingredients,
  steps:recipeCookingSteps[method]||recipeCookingSteps.default
})));

function renderRecipes(){
  const query=$("#recipeSearch").value.trim().toLocaleLowerCase("id");
  const category=$("#recipeCategory").value;
  const matching=healthyRecipes.filter(recipe=>
    (!category||recipe.category===category)&&
    `${recipe.name} ${recipe.description} ${recipe.ingredients.join(" ")}`.toLocaleLowerCase("id").includes(query)
  );
  $("#recipeCount").textContent=`${matching.length} resep`;
  $("#recipeList").innerHTML=matching.map((recipe,index)=>`
    <article class="recipe-card">
      <div class="recipe-visual recipe-visual-${index%6}"><span>${recipe.emoji}</span><small>${esc(recipe.category)}</small></div>
      <div class="recipe-content">
        <h2>${esc(recipe.name)}</h2><p>${esc(recipe.description)}</p>
        <div class="recipe-facts"><span>◷ ${recipe.time} menit</span><span>${recipe.calories} kcal / porsi</span><span>Protein ${recipe.protein} g</span></div>
        <details class="recipe-details">
          <summary>Lihat bahan &amp; cara membuat</summary>
          <h3>Bahan</h3><ul>${recipe.ingredients.map(item=>`<li>${esc(item)}</li>`).join("")}</ul>
          <h3>Cara membuat</h3><ol>${recipe.steps.map(step=>`<li>${esc(step)}</li>`).join("")}</ol>
        </details>
      </div>
    </article>`).join("")||`<p class="recipe-empty">Resepnya belum ketemu. Coba kata kunci atau kategori lain.</p>`;
}
$("#recipeSearch").oninput=renderRecipes;
$("#recipeCategory").onchange=renderRecipes;
renderRecipes();

function showAuth(){me=null;$("#authView").classList.remove("hidden");$("#userApp").classList.add("hidden");$("#adminApp").classList.add("hidden")}
function showUser(animate=false){ $("#authView").classList.add("hidden");$("#adminApp").classList.add("hidden");$("#userApp").classList.remove("hidden");if(animate)animateAppEntry($("#userApp"));showPage("dashboard");loadUser()}
function showAdmin(animate=false){ $("#authView").classList.add("hidden");$("#userApp").classList.add("hidden");$("#adminApp").classList.remove("hidden");if(animate)animateAppEntry($("#adminApp"));loadAdmin()}
function animateAppEntry(app){
  app.classList.remove("app-entry");
  void app.offsetWidth;
  app.classList.add("app-entry");
  setTimeout(()=>app.classList.remove("app-entry"),900);
}
function unlockWelcomeAudio(){
  const player=$("#welcomeAudio");
  player.muted=true;
  const playback=player.play();
  if(playback)playback.then(()=>{
    player.pause();
    player.currentTime=0;
    player.muted=false;
  }).catch(()=>{player.muted=false});
}
function playWelcomeVoice(){
  const player=$("#welcomeAudio");
  player.pause();
  player.currentTime=0;
  player.muted=false;
  const playback=player.play();
  if(playback)playback.catch(error=>{
    if(error.name==="NotAllowedError")toast("Browser memblokir audio otomatis. Aktifkan suara situs lalu coba login kembali.");
    else toast("Suara sambutan gagal diputar. Coba refresh halaman.");
  });
}
$("#welcomeAudio").onerror=()=>toast("File suara sambutan gagal dimuat. Coba refresh halaman.");

$$(".tab").forEach(b=>b.onclick=()=>{ $$(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");["login","register","forgot"].forEach(x=>$("#"+x+"Form").classList.add("hidden"));$("#"+b.dataset.auth+"Form").classList.remove("hidden")});

function showPasswordReset(){
  showAuth();
  $(".tabs").classList.add("hidden");
  ["login","register","forgot","resetPassword"].forEach(name=>$("#"+name+"Form").classList.add("hidden"));
  $("#resetPasswordForm").classList.remove("hidden");
}
supabaseClient?.auth.onAuthStateChange(event=>{
  if(event==="PASSWORD_RECOVERY"){
    passwordRecoveryPending=true;
    showPasswordReset();
  }
});
$("#resetPasswordForm").onsubmit=async event=>{
  event.preventDefault();
  const password=$("#newPassword").value;
  if(password!==$("#confirmNewPassword").value)return toast("Konfirmasi password belum cocok.");
  try{
    supabaseData(await requireSupabase().auth.updateUser({password}));
    history.replaceState(null,"",location.pathname+location.search);
    toast("Password berhasil diperbarui. Silakan login kembali.");
    await requireSupabase().auth.signOut();
    $(".tabs").classList.remove("hidden");
    showAuth();
    $("#loginForm").classList.remove("hidden");
  }catch(error){toast(error.message)}
};

for(let d=1;d<=31;d++)$("#birthDay").insertAdjacentHTML("beforeend",`<option value="${d}">${d}</option>`);
for(let m=1;m<=12;m++)$("#birthMonth").insertAdjacentHTML("beforeend",`<option value="${m}">${m}</option>`);
for(let y=new Date().getFullYear();y>=1900;y--)$("#birthYear").insertAdjacentHTML("beforeend",`<option value="${y}">${y}</option>`);

$("#loginForm").onsubmit=async e=>{
  e.preventDefault();
  unlockWelcomeAudio();
  const submitButton=e.currentTarget.querySelector('button[type="submit"],button:not([type])');
  const originalButtonText=submitButton?.textContent;
  if(submitButton){
    submitButton.disabled=true;
    submitButton.classList.add("is-loading");
    submitButton.textContent="Sedang masuk...";
  }
  try{
    const d=await api("/api/auth/login",{method:"POST",body:{email:$("#loginEmail").value,password:$("#loginPassword").value}});
    me=d.user;
    if(isAdminRoute()&&d.user.role!=="admin"){
      location.assign(appUrl("./").href);
    }else if(isAdminRoute())showAdmin(true);
    else showUser(true);
    playWelcomeVoice();
    toast("Login berhasil");
  }catch(error){
    toast(error.message);
  }finally{
    if(submitButton){
      submitButton.disabled=false;
      submitButton.classList.remove("is-loading");
      submitButton.textContent=originalButtonText;
    }
  }
};
$("#registerForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const d=await api("/api/auth/register",{method:"POST",body:{name:$("#regName").value,email:$("#regEmail").value,password:$("#regPassword").value,birthDay:$("#birthDay").value,birthMonth:$("#birthMonth").value,birthYear:$("#birthYear").value}});
    if(d.confirmationRequired){
      $("#loginEmail").value=$("#regEmail").value;
      $(".tab[data-auth='login']").click();
      toast("Pendaftaran berhasil. Cek email untuk verifikasi akun sebelum login.");
      return;
    }
    if(d.user.role!=="admin"&&isAdminRoute()){
      location.assign(appUrl("./").href);
      return;
    }
    me=d.user;
    showUser();
    toast("Akun berhasil dibuat");
  }catch(e){toast(e.message)}
};
$("#forgotForm").onsubmit=async e=>{e.preventDefault();try{const d=await api("/api/auth/forgot-password",{method:"POST",body:{email:$("#forgotEmail").value,message:$("#forgotMessage").value}});toast(d.message);e.target.reset()}catch(e){toast(e.message)}};

async function loadUser(){try{me=await api("/api/auth/me");$("#helloName").textContent=me.name.split(" ")[0];loadIntakeLog();await Promise.all([loadFoods(),loadDiary(),loadProfile()])}catch(e){toast(e.message)}}
function showPage(name){$$(".page").forEach(p=>p.classList.add("hidden"));$("#"+name+"Page").classList.remove("hidden");$$(".topbar nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===name));if(name==="foods")loadFoods();if(name==="diary")loadDiary()}
$$("[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$("#logoutBtn").onclick=logout;$("#adminLogout").onclick=logout;
async function logout(){
  try{
    if(supabaseClient)await supabaseClient.auth.signOut();
    else localStorage.removeItem(localTokenKey);
    location.assign(appUrl("./").href);
  }catch(error){toast(error.message)}
}

async function loadFoods(){
  try{
    foods=await api("/api/foods?search="+encodeURIComponent($("#foodSearch")?.value||""));
    renderFoods();
  }catch(e){toast(e.message)}
}
function renderFoods(){
  const box=$("#foodList");
  const query=$("#foodSearch").value.trim();
  $("#foodCount").textContent=query
    ?`${foods.length} makanan cocok untuk “${query}”`
    :`${foods.length} makanan tersedia — semuanya ditampilkan`;
  box.innerHTML=foods.map(f=>`<div class="foodrow"><div><b>${esc(f.name)}</b><div class="foodmeta">${esc(f.serving)} · ${f.calories} kcal · P ${f.protein}g · K ${f.carbs}g · L ${f.fat}g</div></div><button class="add" type="button" onclick="addDiary(${f.id})">+ Tambah</button></div>`).join("")||`<p class="muted">Makanan tidak ditemukan.</p>`;
}
$("#foodSearch").oninput=()=>loadFoods();
function addDiary(id){
  const food=foods.find(item=>Number(item.id)===Number(id));
  if(!food){toast("Makanan tidak ditemukan. Muat ulang daftar makanan.");return}
  $("#diaryAddFoodId").value=food.id;
  $("#diaryAddFood").textContent=food.name;
  $("#diaryAddServing").textContent=`1 porsi = ${food.serving}`;
  $("#diaryAddAmount").value="1";
  $("#diaryAddModal").classList.remove("hidden");
  $("#diaryAddAmount").focus();
}
$("#diaryAddForm").onsubmit=async event=>{
  event.preventDefault();
  if(!event.currentTarget.reportValidity())return;
  const foodId=Number($("#diaryAddFoodId").value);
  const amount=Number($("#diaryAddAmount").value);
  if(!Number.isInteger(foodId)||!Number.isFinite(amount)||amount<0.1||amount>100){
    toast("Jumlah porsi tidak valid.");
    return;
  }
  const button=$("#diaryAddSubmit");
  button.disabled=true;
  try{
    await api("/api/diary",{method:"POST",body:{foodId,amount}});
    await loadDiary();
    closeModal("diaryAddModal");
    toast("Makanan berhasil ditambahkan ke diary.");
  }catch(error){toast(error.message)}
  finally{button.disabled=false}
};
async function loadDiary(){try{diary=await api("/api/diary");renderDiary();renderDashboard()}catch(e){toast(e.message)}}
function renderDiary(){const html=diary.map(x=>`<div class="diaryrow"><div><b>${esc(x.name)}</b><div class="smalltext">${x.amount} porsi · ${x.calories*x.amount} kcal · P ${(x.protein*x.amount).toFixed(1)}g</div></div><button class="danger" onclick="removeDiary(${x.id})">Hapus</button></div>`).join("")||`<p class="muted">Belum ada makanan hari ini.</p>`;$("#diaryList").innerHTML=html}
async function removeDiary(id){if(!await confirmAction({title:"Hapus dari diary?",message:"Makanan ini akan dihapus dari catatan harianmu.",confirmText:"Ya, hapus",danger:true}))return;try{await api("/api/diary/"+id,{method:"DELETE"});loadDiary();toast("Dihapus")}catch(e){toast(e.message)}}
function renderDashboard(){
  let calories=0,protein=0,carbs=0;
  diary.forEach(item=>{
    calories+=item.calories*item.amount;
    protein+=item.protein*item.amount;
    carbs+=item.carbs*item.amount;
  });
  $("#dashCalories").textContent=Math.round(calories).toLocaleString("id-ID");
  $("#dashProtein").textContent=Math.round(protein).toLocaleString("id-ID");
  $("#dashCarbs").textContent=Math.round(carbs).toLocaleString("id-ID");
  $("#dashboardDateText").textContent=new Intl.DateTimeFormat("id-ID",{weekday:"long",day:"numeric",month:"long"}).format(new Date());
  $("#dashDiary").innerHTML=diary.slice(0,5).map(item=>`
    <div class="dashboard-food-row">
      <span class="dashboard-food-icon" aria-hidden="true">🥗</span>
      <div class="dashboard-food-copy"><b>${esc(item.name)}</b><small>${item.amount} porsi tercatat</small></div>
      <strong>${Math.round(item.calories*item.amount).toLocaleString("id-ID")} <span>kcal</span></strong>
    </div>`).join("")||`
    <div class="dashboard-empty">
      <span class="dashboard-empty-icon" aria-hidden="true">🍽️</span>
      <div><b>Belum ada makanan dicatat</b><p>Tambahkan makanan pertamamu untuk melihat ringkasan nutrisi di sini.</p></div>
      <button class="dashboard-empty-action" data-page="foods">Tambah makanan <span aria-hidden="true">→</span></button>
    </div>`;
}

function localDateKey(){
  const now=new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}
function userAgeInYears(user){
  if(!user?.birth_year||!user?.birth_month||!user?.birth_day)return null;
  const today=new Date();
  let age=today.getFullYear()-user.birth_year;
  if(today.getMonth()+1<user.birth_month||(today.getMonth()+1===user.birth_month&&today.getDate()<user.birth_day))age--;
  return age;
}
function loadIntakeLog(){
  intakeStorageKey=`mfn_intake_${me.id}_${localDateKey()}`;
  let saved;
  try{saved=JSON.parse(localStorage.getItem(intakeStorageKey)||"[]")}
  catch{
    localStorage.removeItem(intakeStorageKey);
    saved=[];
    toast("Catatan kalori yang tersimpan tidak valid dan telah dikosongkan.");
  }
  intakeItems=Array.isArray(saved)?saved.filter(item=>
    item&&Number.isInteger(item.id)&&typeof item.name==="string"&&typeof item.serving==="string"&&
    Number.isFinite(item.amount)&&item.amount>0&&
    ["calories","protein","carbs","fat"].every(key=>Number.isFinite(item[key])&&item[key]>=0)
  ):[];
  $("#intakeDate").textContent=new Date().toLocaleDateString("id-ID",{weekday:"short",day:"numeric",month:"short"});
  renderIntake();
}
function saveIntakeLog(){
  try{localStorage.setItem(intakeStorageKey,JSON.stringify(intakeItems))}
  catch{toast("Catatan tampil saat ini, tetapi tidak dapat disimpan di perangkat.")}
}
function intakeTotals(){
  return intakeItems.reduce((totals,item)=>{
    totals.calories+=item.calories*item.amount;
    totals.protein+=item.protein*item.amount;
    totals.carbs+=item.carbs*item.amount;
    totals.fat+=item.fat*item.amount;
    return totals;
  },{calories:0,protein:0,carbs:0,fat:0});
}
function getIntakeAdvice(totals){
  if(!intakeItems.length)return[{kind:"neutral",title:"Mulai dari makanan pertamamu",body:"Cari makanan yang kamu makan hari ini, lalu tambahkan porsinya untuk melihat ringkasan gizi."}];
  const advice=[];
  const proteinEnergy=totals.calories?totals.protein*4/totals.calories:0;
  const fatEnergy=totals.calories?totals.fat*9/totals.calories:0;
  const foodNames=intakeItems.map(item=>item.name.toLocaleLowerCase("id"));
  const produceHints=["sayur","buah","brokoli","wortel","bayam","kangkung","sawi","pakcoy","kembang kol","kol","buncis","kacang panjang","tomat","mentimun","selada","paprika","terong","labu","jamur","pepaya","stroberi","blueberry","jeruk","pisang","apel","alpukat","mangga","jambu","melon","semangka","kiwi","pir"];
  const hasProduce=foodNames.some(name=>produceHints.some(hint=>name.includes(hint)));
  if(!hasProduce)advice.push({kind:"add",title:"Tambahkan sayur atau buah",body:"Belum ada sayur atau buah yang tercatat. Coba tambahkan satu porsi untuk variasi dan serat."});
  if(totals.calories&&proteinEnergy<0.1)advice.push({kind:"add",title:"Tambahkan sumber protein",body:"Porsi protein tampak sedikit dibanding total yang tercatat. Pertimbangkan telur, ikan, ayam, tahu, tempe, atau kacang-kacangan."});
  if(totals.calories&&proteinEnergy>=0.1)advice.push({kind:"good",title:"Sumber protein sudah tercatat",body:"Pertahankan variasi protein seperti ikan, telur, tahu, tempe, ayam, atau kacang-kacangan."});
  const carbEnergy=totals.calories?totals.carbs*4/totals.calories:0;
  if(totals.calories&&fatEnergy>0.35)advice.push({kind:"watch",title:"Perhatikan tambahan minyak dan lemak",body:"Lemak menyumbang porsi besar dari asupan yang tercatat. Periksa kembali minyak, saus, gorengan, dan ukuran porsinya."});
  if(totals.calories&&carbEnergy<0.45)advice.push({kind:"add",title:"Pertimbangkan sumber karbohidrat berserat",body:"Tambahkan sesuai kebutuhan, misalnya nasi merah, oat, ubi, jagung, atau roti gandum."});
  if(dailyCalorieTarget&&userAgeInYears(me)>=18){
    const remaining=dailyCalorieTarget-totals.calories;
    if(remaining>dailyCalorieTarget*0.15)advice.push({kind:"add",title:"Asupan tercatat masih di bawah estimasi",body:`Sekitar ${Math.round(remaining).toLocaleString("id-ID")} kkal di bawah estimasi kebutuhan dari mode pertama. Ini perbandingan kasar; kelengkapan catatan dan kebutuhan harian bisa berbeda.`});
    else if(remaining< -dailyCalorieTarget*0.15)advice.push({kind:"watch",title:"Asupan tercatat melewati estimasi",body:`Sekitar ${Math.round(Math.abs(remaining)).toLocaleString("id-ID")} kkal di atas estimasi hari ini. Cek porsi dan kelengkapan catatan; satu hari saja tidak menentukan pola makan.`});
    else advice.push({kind:"good",title:"Asupan mendekati estimasi harian",body:"Total yang tercatat cukup dekat dengan estimasi kebutuhanmu. Ingat, nilai kebutuhan adalah perkiraan."});
  }
  if(!advice.length)advice.push({kind:"good",title:"Catatan terlihat bervariasi",body:"Lanjutkan dengan variasi makanan dan porsi yang sesuai kebutuhanmu."});
  return advice;
}
function renderIntake(){
  const totals=intakeTotals();
  $("#intakeCalories").textContent=Math.round(totals.calories).toLocaleString("id-ID");
  $("#intakeProtein").textContent=totals.protein.toFixed(1);
  $("#intakeCarbs").textContent=totals.carbs.toFixed(1);
  $("#intakeFat").textContent=totals.fat.toFixed(1);
  $("#intakeItems").innerHTML=intakeItems.map((item,index)=>`
    <div class="intake-item">
      <div class="intake-item-name"><strong>${esc(item.name)}</strong><small>${item.amount} × ${esc(item.serving)}</small></div>
      <div class="intake-item-nutrition"><span>${Math.round(item.calories*item.amount)} kcal</span><span>P ${ (item.protein*item.amount).toFixed(1)} g</span><span>K ${ (item.carbs*item.amount).toFixed(1)} g</span><span>L ${ (item.fat*item.amount).toFixed(1)} g</span></div>
      <button class="intake-remove" type="button" data-remove-intake="${index}" aria-label="Hapus ${esc(item.name)}">Hapus</button>
    </div>`).join("")||`<p class="intake-empty">Belum ada makanan dicatat. Tambahkan makanan di atas untuk mulai menghitung.</p>`;
  $("#intakeClearButton").classList.toggle("hidden",intakeItems.length===0);
  const progress=$("#intakeProgress");
  if(dailyCalorieTarget&&userAgeInYears(me)>=18){
    const percentage=Math.min(100,Math.round(totals.calories/dailyCalorieTarget*100));
    progress.innerHTML=`<div class="intake-progress-copy"><span>Perbandingan dengan estimasi kebutuhan dewasa</span><strong>${Math.round(totals.calories).toLocaleString("id-ID")} / ${dailyCalorieTarget.toLocaleString("id-ID")} kkal</strong></div><div class="intake-progress-track"><span style="width:${percentage}%"></span></div>`;
    progress.classList.remove("hidden");
  }else progress.classList.add("hidden");
  $("#intakeAdvice").innerHTML=getIntakeAdvice(totals).map(item=>
    `<article class="intake-advice-item kind-${item.kind}"><strong>${esc(item.title)}</strong><p>${esc(item.body)}</p></article>`
  ).join("");
}
async function searchIntakeFoods(query,sequence){
  try{
    const matches=await api("/api/foods?search="+encodeURIComponent(query));
    if(sequence!==intakeSearchSequence)return;
    intakeSearchResults=matches.slice(0,8);
    const box=$("#intakeSuggestions");
    box.innerHTML=intakeSearchResults.map(food=>`
      <button class="intake-suggestion" type="button" role="option" aria-selected="false" data-intake-food="${food.id}">
        <span><strong>${esc(food.name)}</strong><small>${esc(food.serving)}</small></span>
        <span class="intake-suggestion-kcal">${food.calories} kcal</span>
      </button>`).join("")||`<p class="intake-no-match">Belum ditemukan. Coba kata kunci lain atau nama bahan yang lebih sederhana.</p>`;
    box.classList.remove("hidden");
  }catch(error){toast(error.message)}
}
$("#intakeSearch").oninput=()=>{
  const query=$("#intakeSearch").value.trim();
  selectedIntakeFood=null;
  $("#intakeSelected").classList.add("hidden");
  $("#intakeAddButton").disabled=true;
  $("#intakeServing").textContent="";
  const suggestions=$("#intakeSuggestions");
  clearTimeout(intakeSearchTimer);
  if(query.length<2){intakeSearchSequence++;intakeSearchResults=[];suggestions.classList.add("hidden");suggestions.innerHTML="";return}
  suggestions.innerHTML='<p class="intake-no-match">Mencari makanan...</p>';
  suggestions.classList.remove("hidden");
  const sequence=++intakeSearchSequence;
  intakeSearchTimer=setTimeout(()=>searchIntakeFoods(query,sequence),220);
};
$("#intakeSuggestions").onclick=event=>{
  const button=event.target.closest("[data-intake-food]");
  if(!button)return;
  selectedIntakeFood=intakeSearchResults.find(food=>food.id===Number(button.dataset.intakeFood));
  if(!selectedIntakeFood){
    searchIntakeFoods($("#intakeSearch").value.trim(),++intakeSearchSequence);
    return;
  }
  $("#intakeSearch").value=selectedIntakeFood.name;
  $("#intakeServing").textContent=`1 porsi = ${selectedIntakeFood.serving}`;
  $("#intakeSelected").innerHTML=`Dipilih: <strong>${esc(selectedIntakeFood.name)}</strong> · ${selectedIntakeFood.calories} kcal per ${esc(selectedIntakeFood.serving)}`;
  $("#intakeSelected").classList.remove("hidden");
  $("#intakeSuggestions").classList.add("hidden");
  $("#intakeAddButton").disabled=false;
};
$("#intakeForm").onsubmit=event=>{
  event.preventDefault();
  const amount=Number($("#intakeAmount").value);
  if(!selectedIntakeFood)return toast("Pilih makanan dari hasil pencarian terlebih dahulu.");
  if(!Number.isFinite(amount)||amount<0.1||amount>100)return toast("Jumlah porsi harus antara 0,1 dan 100.");
  intakeItems.push({
    id:selectedIntakeFood.id,name:selectedIntakeFood.name,serving:selectedIntakeFood.serving,amount,
    calories:selectedIntakeFood.calories,protein:selectedIntakeFood.protein,carbs:selectedIntakeFood.carbs,fat:selectedIntakeFood.fat
  });
  saveIntakeLog();
  selectedIntakeFood=null;
  $("#intakeSearch").value="";
  $("#intakeAmount").value="1";
  $("#intakeServing").textContent="";
  $("#intakeSelected").classList.add("hidden");
  $("#intakeSuggestions").classList.add("hidden");
  $("#intakeAddButton").disabled=true;
  renderIntake();
};
$("#intakeItems").onclick=event=>{
  const button=event.target.closest("[data-remove-intake]");
  if(!button)return;
  intakeItems.splice(Number(button.dataset.removeIntake),1);
  saveIntakeLog();
  renderIntake();
};
$("#intakeClearButton").onclick=()=>{
  if(!intakeItems.length)return;
  intakeItems=[];
  saveIntakeLog();
  renderIntake();
};
function setCalculatorMode(mode){
  const needs=mode==="needs";
  $("#needsMode").classList.toggle("hidden",!needs);
  $("#intakeMode").classList.toggle("hidden",needs);
  $("#needsModeButton").classList.toggle("active",needs);
  $("#intakeModeButton").classList.toggle("active",!needs);
  $("#needsModeButton").setAttribute("aria-selected",String(needs));
  $("#intakeModeButton").setAttribute("aria-selected",String(!needs));
}
$("#needsModeButton").onclick=()=>setCalculatorMode("needs");
$("#intakeModeButton").onclick=()=>setCalculatorMode("intake");

const adultActivityOptions=[
  {value:"1.2",label:"Jarang — banyak duduk, hampir tidak olahraga"},
  {value:"1.375",label:"Ringan — olahraga ringan 1–3 hari/minggu"},
  {value:"1.55",label:"Sedang — olahraga 3–5 hari/minggu"},
  {value:"1.725",label:"Aktif — olahraga berat 6–7 hari/minggu"},
  {value:"1.9",label:"Sangat aktif — latihan berat / pekerjaan fisik"}
];
const childActivityOptions=[
  {value:"sedentary",label:"Jarang aktif — kegiatan sehari-hari ringan"},
  {value:"lowActive",label:"Agak aktif — banyak bergerak ringan"},
  {value:"active",label:"Aktif — bermain atau olahraga rutin"},
  {value:"veryActive",label:"Sangat aktif — banyak olahraga dan bergerak"}
];
const childActivityFactors={
  male:{sedentary:1,lowActive:1.13,active:1.26,veryActive:1.42},
  female:{sedentary:1,lowActive:1.16,active:1.31,veryActive:1.56}
};
function updateCalculatorFields(){
  const age=$("#calcAge").value===""?null:Number($("#calcAge").value);
  const isUnderThree=age!==null&&age<3;
  const isChild=age!==null&&age>=3&&age<18;
  const activity=$("#calcActivity");
  const previousValue=activity.value;
  const options=isChild?childActivityOptions:adultActivityOptions;
  activity.innerHTML=options.map(option=>`<option value="${option.value}">${option.label}</option>`).join("");
  if(isUnderThree){
    activity.innerHTML='<option value="">Tidak digunakan untuk usia 0–2 tahun</option>';
    activity.disabled=true;
    activity.required=false;
    $("#calcActivityHelp").textContent="Rumus untuk usia 0–2 tahun tidak memakai faktor aktivitas.";
  }else{
    activity.disabled=false;
    activity.required=true;
    activity.value=options.some(option=>option.value===previousValue)?previousValue:options[0].value;
    $("#calcActivityHelp").textContent=isChild
      ?"Pilih tingkat aktivitas harian anak; faktornya menyesuaikan jenis kelamin."
      :"Pilih tingkat yang paling mendekati rutinitasmu.";
  }
  $("#calcHeight").required=!isUnderThree;
  $("#calcHeightHelp").textContent=isUnderThree
    ?"Untuk usia 0–2 tahun, rumus ini tidak memakai tinggi badan."
    :"Dalam sentimeter (cm).";
  $("#calcAgeHelp").textContent=isUnderThree
    ?"Usia 0, 1, atau 2 tahun; untuk bayi di bawah 1 tahun, masukkan 0."
    :"Untuk bayi di bawah 1 tahun, masukkan 0.";
}
$("#calcAge").oninput=updateCalculatorFields;
$("#calcGender").onchange=updateCalculatorFields;
updateCalculatorFields();

function estimateDailyCalories({age,gender,weight,height,activity}){
  if(age<3){
    return {
      daily:89*weight-100+20,
      activityLabel:"Tidak diterapkan untuk usia 0–2 tahun",
      method:"Estimasi usia 0–2 tahun berbasis berat badan",
      breakdown:[{label:"Dasar estimasi",value:"Berat badan"},{label:"Faktor aktivitas",value:"Tidak diterapkan"}]
    };
  }
  if(age<18){
    const heightMeters=height/100;
    const pa=childActivityFactors[gender][activity];
    const base=gender==="male"
      ?88.5-61.9*age+(26.7*weight+903*heightMeters)*pa
      :135.3-30.8*age+(10*weight+934*heightMeters)*pa;
    const ageAdjustment=age<9?20:25;
    return {
      daily:base+ageAdjustment,
      activityLabel:`Faktor aktivitas ${pa}`,
      method:age<9?"Rumus kebutuhan anak usia 3–8 tahun":"Rumus kebutuhan anak dan remaja usia 9–17 tahun",
      breakdown:[
        {label:"Faktor aktivitas",value:`PA ${pa}`},
        {label:"Penyesuaian kelompok usia",value:`+${ageAdjustment} kkal`}
      ]
    };
  }
  const bmr=gender==="male"
    ?10*weight+6.25*height-5*age+5
    :10*weight+6.25*height-5*age-161;
  return {
    daily:bmr*Number(activity),
    activityLabel:`Faktor aktivitas × ${activity}`,
    method:"Rumus Mifflin–St Jeor untuk dewasa",
    breakdown:[
      {label:"Kalori dasar (BMR)",value:`${Math.round(bmr).toLocaleString("id-ID")} kkal`},
      {label:"Faktor aktivitas",value:`× ${activity}`}
    ]
  };
}
$("#calculatorForm").onsubmit=e=>{
  e.preventDefault();
  const age=Number($("#calcAge").value);
  const weight=Number($("#calcWeight").value);
  const height=Number($("#calcHeight").value);
  if(!e.currentTarget.reportValidity())return;
  const gender=$("#calcGender").value;
  const activity=$("#calcActivity").value;
  const hasHeight=age>=3;
  if(!Number.isInteger(age)||age<0||age>120||!Number.isFinite(weight)||weight<2||weight>400||(hasHeight&&(!Number.isFinite(height)||height<30||height>250)))
    return toast("Periksa kembali usia, berat, dan tinggi badan.");
  if(age>=3&&!activity)return toast("Pilih tingkat aktivitas.");
  const estimate=estimateDailyCalories({age,gender,weight,height,activity});
  if(!Number.isFinite(estimate.daily)||estimate.daily<=0)
    return toast("Data tersebut belum menghasilkan estimasi yang valid. Periksa kembali berat dan tinggi.");
  const daily=Math.round(estimate.daily);
  dailyCalorieTarget=age>=18?daily:null;
  renderIntake();
  const result=$("#calcResult");
  result.innerHTML=`
    <div class="result-heading"><div><span class="eyebrow">HASIL PERKIRAANMU</span><h2>Kebutuhan energi harian</h2></div><span class="result-spark" aria-hidden="true">✦</span></div>
    <div class="result-total"><strong>${daily.toLocaleString("id-ID")}</strong><span>kkal / hari</span></div>
    <p class="result-caption">${esc(estimate.method)}. Hasil aktivitas: ${esc(estimate.activityLabel)}.</p>
    <div class="result-breakdown">${estimate.breakdown.map(item=>`<div><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></div>`).join("")}</div>
    <p class="result-disclaimer">${age<18?"Khusus anak dan remaja: ini hanya estimasi awal, bukan target diet. Kebutuhan untuk tumbuh kembang berbeda pada tiap anak. Konsultasikan dengan dokter atau ahli gizi anak sebelum mengubah pola makan.":"Angka ini adalah estimasi, bukan target medis. Kebutuhan nyata dapat berbeda; konsultasikan dengan dokter atau ahli gizi untuk saran sesuai kondisimu."}</p>`;
  result.classList.remove("hidden");
};
async function loadProfile(){
  const user=await api("/api/auth/me");
  const initials=user.name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join("").toLocaleUpperCase("id");
  const birthDate=new Date(user.birth_year,user.birth_month-1,user.birth_day);
  const birthLabel=birthDate.toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"});
  const joinedDate=user.created_at?new Date(`${user.created_at.replace(" ","T")}Z`):null;
  const joinedLabel=joinedDate&&!Number.isNaN(joinedDate.getTime())
    ?joinedDate.toLocaleDateString("id-ID",{month:"long",year:"numeric"})
    :"";
  $("#profileBox").innerHTML=`
    <div class="profile-identity">
      <div class="profile-avatar" aria-hidden="true">${esc(initials)}</div>
      <div class="profile-identity-copy">
        <span class="profile-kicker">PROFIL PENGGUNA</span>
        <h2>${esc(user.name)}</h2>
        <p>${esc(user.email)}</p>
      </div>
      <span class="profile-status"><i></i> Akun aktif</span>
    </div>
    <div class="profile-details">
      <div><span class="profile-detail-icon" aria-hidden="true">✳</span><span><small>Tanggal lahir</small><strong>${esc(birthLabel)}</strong></span></div>
      ${joinedLabel?`<div><span class="profile-detail-icon profile-detail-icon-soft" aria-hidden="true">⌂</span><span><small>Bergabung sejak</small><strong>${esc(joinedLabel)}</strong></span></div>`:""}
    </div>`;
  $("#profileName").value=user.name;
  $("#profileEmail").value=user.email;
}
$("#profileForm").onsubmit=async e=>{
  e.preventDefault();
  if(!e.currentTarget.reportValidity())return;
  try{
    const data=await api("/api/profile",{method:"PATCH",body:{name:$("#profileName").value}});
    me=data.user;
    $("#helloName").textContent=me.name.split(" ")[0];
    await loadProfile();
    toast("Profil berhasil diperbarui");
  }catch(error){toast(error.message)}
}
$("#passwordForm").onsubmit=async e=>{
  e.preventDefault();
  if(!e.currentTarget.reportValidity())return;
  const password=$("#newAccountPassword").value;
  if(password!==$("#confirmAccountPassword").value){
    toast("Konfirmasi password baru belum cocok.");
    return;
  }
  try{
    const result=await api("/api/profile/password",{
      method:"POST",
      body:{currentPassword:$("#currentPassword").value,password}
    });
    if(!supabaseClient)localStorage.removeItem(localTokenKey);
    e.currentTarget.reset();
    toast(result.message);
    setTimeout(()=>location.assign(appUrl("./").href),900);
  }catch(error){toast(error.message)}
};

/* ADMIN */
async function loadAdmin(){
  $("#adminToday").textContent=new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  try{await Promise.all([loadStats(),loadAdmins(),loadUsers(),loadReports(),loadAdminFoods()])}catch(e){toast(e.message)}
}
async function loadStats(){
  const stats=await api("/api/admin/stats");
  $("#statUsers").textContent=Number(stats.users||0).toLocaleString("id-ID");
  $("#statActive").textContent=Number(stats.activeUsers||0).toLocaleString("id-ID");
  $("#statFoods").textContent=Number(stats.foods||0).toLocaleString("id-ID");
  $("#statReports").textContent=Number(stats.pendingReports||0).toLocaleString("id-ID");
  $("#statVisitors").textContent=Number(stats.visitors||0).toLocaleString("id-ID");
  $("#statVisitsToday").textContent=Number(stats.visitsToday||0).toLocaleString("id-ID");
}
async function loadUsers(){
  const q=$("#userSearch").value;
  const rows=await api("/api/admin/users?search="+encodeURIComponent(q));
  $("#usersTable").innerHTML=rows.map(user=>`<tr><td><b>${esc(user.name)}</b></td><td>${esc(user.email)}</td><td>${user.birth_day}/${user.birth_month}/${user.birth_year}</td><td><span class="admin-status ${user.status==="active"?"is-active":"is-disabled"}">${esc(user.status==="active"?"Aktif":"Nonaktif")}</span></td><td>${Number(user.diary_count||0)}</td><td><div class="actions"><button class="add" onclick="viewUser('${esc(user.id)}')">Detail</button><button class="warning" onclick="resetPassword('${esc(user.id)}')">${supabaseClient?"Kirim link reset":"Atur password"}</button><button class="${user.status==="active"?"danger":"add"}" onclick="toggleUser('${esc(user.id)}','${user.status==="active"?"disabled":"active"}')">${user.status==="active"?"Nonaktif":"Aktifkan"}</button></div></td></tr>`).join("")||`<tr><td colspan="6" class="admin-empty">Tidak ada pengguna yang cocok.</td></tr>`;
}
async function loadAdmins(){
  const rows=await api("/api/admin/admins");
  $("#adminCount").textContent=`${rows.length.toLocaleString("id-ID")} admin`;
  $("#adminsTable").innerHTML=rows.map(admin=>`<tr><td><b>${esc(admin.name)}</b></td><td>${esc(admin.email)}</td><td><span class="admin-status ${admin.status==="active"?"is-active":"is-disabled"}">${esc(admin.status==="active"?"Aktif":"Nonaktif")}</span></td><td>${admin.created_at?esc(new Date(`${admin.created_at.replace(" ","T")}Z`).toLocaleDateString("id-ID")):"-"}</td></tr>`).join("")||`<tr><td colspan="4" class="admin-empty">Belum ada akun admin.</td></tr>`;
}
$("#userSearch").oninput=()=>loadUsers();
async function viewUser(id){
  try{
    const detail=await api(`/api/admin/users/${encodeURIComponent(id)}`);
    const user=detail.user;
    const initials=user.name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join("").toLocaleUpperCase("id");
    const birthDate=new Date(user.birth_year,user.birth_month-1,user.birth_day);
    const birthLabel=birthDate.toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"});
    const statusLabel=user.status==="active"?"Aktif":"Nonaktif";
    const diaryMarkup=detail.diary.map(item=>`<article class="user-diary-item"><span class="user-diary-icon" aria-hidden="true">◉</span><span class="user-diary-copy"><b>${esc(item.name)}</b><small>${Number(item.amount).toLocaleString("id-ID")} porsi · ${(Number(item.calories)*Number(item.amount)).toLocaleString("id-ID")} kkal</small></span><time>${esc(new Date(`${item.created_at.replace(" ","T")}Z`).toLocaleDateString("id-ID",{day:"numeric",month:"short"}))}</time></article>`).join("");
    $("#userDetail").innerHTML=`
      <section class="user-detail-identity">
        <span class="user-detail-avatar" aria-hidden="true">${esc(initials)}</span>
        <span class="user-detail-name"><small>PROFIL PENGGUNA</small><b>${esc(user.name)}</b><span>${esc(user.email)}</span></span>
        <span class="admin-status ${user.status==="active"?"is-active":"is-disabled"}">${statusLabel}</span>
      </section>
      <section class="user-detail-facts" aria-label="Informasi akun">
        <div><small>Tanggal lahir</small><b>${esc(birthLabel)}</b></div>
        <div><small>Peran akun</small><b>${user.role==="admin"?"Administrator":"Pengguna"}</b></div>
      </section>
      <section class="user-detail-diary">
        <div class="user-detail-diary-heading"><span><small>AKTIVITAS PENGGUNA</small><b>Food diary</b></span><span class="user-detail-diary-count">${detail.diary.length} catatan</span></div>
        <div class="user-detail-diary-list">${diaryMarkup||`<p class="user-detail-empty">Belum ada catatan makanan.</p>`}</div>
      </section>`;
    $("#userModal").classList.remove("hidden");
    $("#userModal .x").focus();
  }catch(error){toast(error.message)}
}
function openPasswordModal({userId="",reportId="",email=""}={}){
  $("#passwordTargetId").value=userId;
  $("#passwordReportId").value=reportId;
  $("#passwordModalTitle").textContent=reportId?"Atur password dari laporan":"Atur password user";
  $("#passwordModalDescription").textContent=email
    ?`Password baru akan diatur untuk akun ${email}. Password lama tidak bisa dilihat.`
    :"Masukkan password baru minimal 8 karakter. Password lama tidak dapat dilihat.";
  $("#adminPasswordForm").reset();
  $("#passwordTargetId").value=userId;
  $("#passwordReportId").value=reportId;
  $("#passwordModal").classList.remove("hidden");
  $("#adminNewPassword").focus();
}
async function resetPassword(id){
  try{
    if(supabaseClient){
      const d=await api("/api/admin/users/"+id+"/reset-password",{method:"POST"});
      toast(d.message);
      return;
    }
    const detail=await api("/api/admin/users/"+encodeURIComponent(id));
    const user=detail.user;
    openPasswordModal({userId:id,email:user.email});
  }catch(e){toast(e.message)}
}
async function resetReportPassword(id){
  try{
    if(supabaseClient){
      const d=await api("/api/admin/password-reports/"+id+"/reset",{method:"POST"});
      toast(d.message);
      return;
    }
    const reports=await api("/api/admin/password-reports");
    const report=reports.find(item=>item.id===id);
    if(!report)throw new Error("Laporan tidak ditemukan.");
    const matches=await api("/api/admin/users?search="+encodeURIComponent(report.email));
    const user=matches.find(item=>item.email.toLowerCase()===report.email.toLowerCase());
    if(!user)throw new Error("Email laporan belum terdaftar sebagai akun. Tidak ada password yang diubah.");
    openPasswordModal({userId:user.id,reportId:id,email:user.email});
  }catch(e){toast(e.message)}
}
$("#adminPasswordForm").onsubmit=async event=>{
  event.preventDefault();
  if(!event.currentTarget.reportValidity())return;
  const password=$("#adminNewPassword").value;
  if(password!==$("#adminConfirmPassword").value){
    toast("Konfirmasi password belum cocok.");
    return;
  }
  const userId=$("#passwordTargetId").value;
  const reportId=$("#passwordReportId").value;
  const button=$("#adminPasswordSubmit");
  button.disabled=true;
  try{
    const result=await api(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`,{
      method:"POST",
      body:supabaseClient?{}:{newPassword:password}
    });
    if(reportId)await api(`/api/admin/password-reports/${encodeURIComponent(reportId)}/resolve`,{method:"POST"});
    closeModal("passwordModal");
    await Promise.all([loadUsers(),loadReports(),loadStats()]);
    toast(result.message);
  }catch(error){toast(error.message)}
  finally{button.disabled=false}
};
async function resolvePasswordReport(id){try{await api("/api/admin/password-reports/"+id+"/resolve",{method:"POST"});await Promise.all([loadReports(),loadStats()]);toast("Laporan ditandai selesai.")}catch(e){toast(e.message)}}
async function toggleUser(id,status){
  const disabling=status==="disabled";
  const confirmed=await confirmAction({
    title:disabling?"Nonaktifkan pengguna?":"Aktifkan pengguna?",
    message:disabling?"Pengguna ini tidak bisa masuk selama akunnya nonaktif. Kamu bisa mengaktifkannya lagi kapan saja.":"Pengguna ini akan bisa masuk dan menggunakan akunnya kembali.",
    confirmText:disabling?"Nonaktifkan akun":"Aktifkan akun",
    danger:disabling
  });
  if(!confirmed)return;
  try{await api(`/api/admin/users/${encodeURIComponent(id)}/status`,{method:"PATCH",body:{status}});await Promise.all([loadUsers(),loadStats()]);toast("Status diperbarui")}catch(error){toast(error.message)}
}
async function loadReports(){
  const rows=await api("/api/admin/password-reports");
  $("#reportsTable").innerHTML=rows.map(report=>`<tr><td>${esc(report.email)}</td><td>${esc(report.name||"-")}</td><td>${esc(report.message||"")}</td><td><span class="admin-status ${report.status==="pending"?"is-pending":"is-resolved"}">${esc(report.status==="pending"?"Pending":"Selesai")}</span></td><td>${esc(new Date(report.created_at).toLocaleString("id-ID"))}</td><td>${report.status==="pending"?`<div class="actions"><button class="warning" onclick="resetReportPassword(${report.id})">${supabaseClient?"Kirim link reset":"Atur password"}</button><button class="add" onclick="resolvePasswordReport(${report.id})">Selesai</button></div>`:"Selesai"}</td></tr>`).join("")||`<tr><td colspan="6" class="admin-empty">Belum ada laporan bantuan password.</td></tr>`;
}
async function loadAdminFoods(){const rows=await api("/api/foods");$("#adminFoods").innerHTML=rows.map(f=>`<div class="foodrow"><div><b>${esc(f.name)}</b><div class="smalltext">${esc(f.serving)} · ${f.calories} kcal · P ${f.protein}g · K ${f.carbs}g · L ${f.fat}g</div></div><div class="actions"><button class="warning" onclick='editFood(${JSON.stringify(f)})'>Edit</button><button class="danger" onclick="deleteFood(${f.id})">Hapus</button></div></div>`).join("")||`<p class="admin-empty">Belum ada data makanan di katalog.</p>`}
$("#addFoodBtn").onclick=()=>openFoodModal();
let confirmDialogResolve=null;
function closeModal(id){
  if(id==="confirmModal"){resolveConfirm(false);return}
  $("#"+id).classList.add("hidden");
}
function resolveConfirm(confirmed){
  const modal=$("#confirmModal");
  modal.classList.add("hidden");
  const resolve=confirmDialogResolve;
  confirmDialogResolve=null;
  resolve?.(confirmed);
}
function confirmAction({title,message,confirmText="Lanjutkan",danger=false}){
  if(confirmDialogResolve)resolveConfirm(false);
  $("#confirmTitle").textContent=title;
  $("#confirmMessage").textContent=message;
  $("#confirmActionButton").textContent=confirmText;
  $("#confirmActionButton").className=danger?"danger":"primary";
  $("#confirmIcon").textContent=danger?"!":"?";
  $("#confirmIcon").classList.toggle("is-danger",danger);
  $("#confirmModal").classList.remove("hidden");
  $("#confirmActionButton").focus();
  return new Promise(resolve=>{confirmDialogResolve=resolve});
}
$$(".modal").forEach(modal=>modal.addEventListener("click",event=>{
  if(event.target===modal)closeModal(modal.id);
}));
document.addEventListener("keydown",event=>{
  if(event.key!=="Escape")return;
  const openModalElement=[...$$(".modal")].reverse().find(modal=>!modal.classList.contains("hidden"));
  if(openModalElement)closeModal(openModalElement.id);
});
function openFoodModal(f){
  $("#foodModalTitle").textContent=f?"Edit Makanan":"Tambah Makanan";
  $("#foodId").value=f?.id||"";
  $("#foodName").value=f?.name||"";
  $("#foodServing").value=f?.serving||"";
  $("#foodCalories").value=f?.calories??"";
  $("#foodProtein").value=f?.protein??"";
  $("#foodCarbs").value=f?.carbs??"";
  $("#foodFat").value=f?.fat??"";
  $("#foodModal").classList.remove("hidden");
  $("#foodName").focus();
}
function editFood(f){openFoodModal(f)}
$("#foodForm").onsubmit=async e=>{e.preventDefault();const body={name:$("#foodName").value,serving:$("#foodServing").value,calories:Number($("#foodCalories").value),protein:Number($("#foodProtein").value),carbs:Number($("#foodCarbs").value),fat:Number($("#foodFat").value)};try{const id=$("#foodId").value;await api(id?"/api/admin/foods/"+id:"/api/admin/foods",{method:id?"PUT":"POST",body});closeModal("foodModal");loadAdminFoods();loadStats();toast("Makanan disimpan")}catch(e){toast(e.message)}}
async function deleteFood(id){
  const confirmed=await confirmAction({title:"Hapus makanan ini?",message:"Makanan akan dihapus dari katalog. Jika makanan sudah dipakai di diary, penghapusan bisa ditolak.",confirmText:"Ya, hapus makanan",danger:true});
  if(!confirmed)return;
  try{await api(`/api/admin/foods/${encodeURIComponent(id)}`,{method:"DELETE"});await Promise.all([loadAdminFoods(),loadStats()]);toast("Makanan dihapus")}catch(error){toast(error.message)}
}

(async function boot(){
  recordSiteVisit();
  if(!supabaseClient){
    const token=localStorage.getItem(localTokenKey);
    if(!token){
      showAuth();
      if(isAdminRoute())toast("Silakan login menggunakan akun admin.");
      return;
    }
    try{
      me=await api("/api/auth/me");
      if(isAdminRoute()&&me.role!=="admin"){
        location.replace(appUrl("./").href);
        return;
      }
      if(isAdminRoute()&&me.role==="admin")showAdmin();
      else showUser();
    }catch(error){
      showAuth();
      toast(error.message);
    }
    return;
  }
  try{
    const session=supabaseData(await supabaseClient.auth.getSession());
    if(!session.session){
      showAuth();
      if(isAdminRoute())toast("Silakan login menggunakan akun admin.");
      return;
    }
    if(passwordRecoveryPending){
      showPasswordReset();
      return;
    }
    me=await api("/api/auth/me");
    if(isAdminRoute()&&me.role!=="admin"){
      location.replace(appUrl("./").href);
      return;
    }
    if(isAdminRoute()&&me.role==="admin")showAdmin();
    else showUser();
  }catch(error){
    await supabaseClient.auth.signOut();
    showAuth();
    toast(error.message);
  }
})();
