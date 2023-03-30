/*----------------------&&~~~~Import~~~~&&------------------- */
import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import helmet from "helmet";
import morgan from "morgan";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import {initializeApp} from"firebase/app";
import firebaseConfig from"./config/firebase.js";
import {Configuration,OpenAIApi} from "openai";
import {getStorage,ref,getDownloadURL,uploadBytesResumable} from "firebase/storage";


/*----------------------OpenAI && Configuration------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();
const token= process.env.API_TOKEN;
const configuration=new Configuration({
    apiKey:token
});
const openai=new OpenAIApi(configuration);


/*----------------------Configuration------------------- */

initializeApp(firebaseConfig);
mongoose.connect(process.env.MONGO_URL,{ useNewUrlParser: true, useUnifiedTopology: true }).then(()=>{    
console.log("Connected to DataBase!!");
});
const app=express();
app.use(bodyParser.json({limit:"30mb",extended:true}));
app.use(cors());
app.use(helmet());
app.use(bodyParser.urlencoded({limit:"30mb",extended:true}));
app.use(helmet.crossOriginResourcePolicy({policy:"cross-origin"}));
app.use("/assets",express.static(path.join(__dirname,"public/assets")));

/*----------------- Storage --------------*/

const upload= multer({ storage: multer.memoryStorage() });
const cloudStorage=getStorage();

/*----------------- Schema & Objects--------------*/

const tokenSchema= new mongoose.Schema({
    uid:String,
    token:String,
    expireAt: {
        type: Date,
        default: Date.now,
        index: { expires: '1h' },
      }
});
const TokenModel= mongoose.model("token",tokenSchema);

const UserSchema= new mongoose.Schema({
    id:String,
    name:{
        type: String,
        require :true,
        min:2,
        max:50,
    },
    email:{
        type: String,
        require :true,
        max:50,
        unique:true
    },
    picPath:{
        type: String,
        default: "",
    },
    streak: Date,
    viewedProfile: Number,
    location:String,
},{timestamps:true});

const User=mongoose.model("User",UserSchema);

const postSchema=new mongoose.Schema({
    userId:String,
    name:String,
    description:String,
    postPath:String,
    userPath:String,
    likes:{
        type:Map,
        of: Boolean,
    },
    createAt:{type :Date,default:Date.now()},
});
const Post=mongoose.model("Post",postSchema);


/*----------------- Links & Path--------------*/

app.get("/verify/:tok",(req,res)=>{
        const validT=TokenModel.findOne({token:req.params.tok}).then((data)=>{
            if(data==null){
                res.status(205).send("No Record Found");
            }
            else{
                res.status(200).send("Found");
            }
        });
})

app.get("/logout/:tok",(req,res)=>{
    TokenModel.findOneAndDelete({token:req.params.tok}).then(console.log("Deleted!"));
});

app.post("/login",(req,response)=>{
    const userMail=req.body.email;
    const userPass=req.body.pass;
    const url="https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="+process.env.FIREBASE_API;
    fetch(url,{
        method:"POST",
        body:JSON.stringify({
            email:userMail,
            password:userPass,
            returnSecureToken:true
        }),
        headers:{
            'Content-Type':'application/json'
        }
    }).then(res=>{
        if(res.ok){
            return res.json().then(async (data)=>{
                const existUser= await TokenModel.findOne({uid:data.email});
                if(!existUser){
                    const uid=data.email;
                    const to=data.idToken;
                    const newUser=new TokenModel({
                    uid:uid,
                    token:to
                });
                const tokenResp= await newUser.save();
                const findUser= await User.findOne({id:data.localId});
                const finalData={
                user:findUser,
                idToken:data.idToken,
                id:data.localId,
            };
                response.status(200).send(finalData);
            }
            else{
                const findUser= await User.findOne({id:data.localId});
                const finalData={
                user:findUser,
                idToken:existUser.token,
                id:data.localId,
            };
                response.status(200).send(finalData);
            }  
            })
        }else{
            return res.json().then((data)=>{
                console.log(data.error.message);
                response.status(400).send(data.error.message);
            });
        }
    });
});

app.post("/signup",upload.single("picture"), async (req,response)=>{
    const userName=req.body.name;
    const userMail=req.body.email;
    const userPass=req.body.pass;
    const userLocation=req.body.location;
    const firebase_URL="https://identitytoolkit.googleapis.com/v1/accounts:signUp?key="+process.env.FIREBASE_API;
    const profilepic=ref(cloudStorage,`profilepic/${userMail}`);
    const metadata={
        contentType:req.file.mimetype,
    };
    const snapshot = await uploadBytesResumable(profilepic,req.file.buffer,metadata);
    const userURL= await getDownloadURL(snapshot.ref);
    fetch(firebase_URL,{
            method:"POST",
            body:JSON.stringify({
                email:userMail,
                password:userPass,
                returnSecureToken:true
            }),
            headers:{
                'Content-Type':'application/json'
            }
        }).then(res=>{
            if(res.ok){
                return res.json().then(async (data)=>{
                    const uid=data.email;
                    const to=data.idToken;
                    const newToken=new TokenModel({
                        uid:uid,
                        token:to
                    });
                    newToken.save();
                    const newUser=new User({
                        id:data.localId,
                        name:userName,
                        email:userMail,
                        picPath:userURL,
                        streak:new Date(),
                        viewedProfile:0,
                        location:userLocation,
                    });
                    const createdUser= await newUser.save();
                    const finalData={
                        user:createdUser,
                        idToken:data.idToken,
                        id:data.localId,
                    };
                    response.status(200).send(finalData);
                })
            }else{
                return res.json().then((data)=>{
                    console.log(data.error.message);
                    response.status(400).send(data.error.message);
                });
            }
        });
});

app.get("/user/:uid",async (req,res)=>{
    try{let token = req.header("Authorization");
    if (!token) {
      return res.status(403).send("Access Denied");
    }
    const verify= await TokenModel.find({"token":token});

    if(!verify)return res.status(403).send("Access Denied");
    const mail=verify[0].uid;
    const uid=req.params.uid;
    const user = await User.find({id:uid});
    res.status(200).send(user);
    User.find({email:mail}).then( async (vistor)=>{
        if(vistor[0].id!==uid){await User.updateOne({id:uid},{$inc:{viewedProfile:0.5}});}
    });
    }catch(err){
        res.status(404).json({ message: err.message });
    }
});
app.post("/posts",upload.single("picture"), async (req,res)=>{

    try{let token = req.header("Authorization");
    if (!token) {
      return res.status(403).send("Access Denied");
    }
    const verify= await TokenModel.find({"token":token});
    if(!verify)return res.status(403).send("Access Denied");
    const userMail=req.body.mail;
    if(userMail!==verify[0].uid)return res.status(403).send("Access Denied");
    const userId=req.body.userId;
    const desc=req.body.description;
    const postPic=ref(cloudStorage,`postPic/${userMail}-${req.body.picturePath}`);
    const metadata={
        contentType:req.file.mimetype,
    };
    const snapshot = await uploadBytesResumable(postPic,req.file.buffer,metadata);
    const postURL= await getDownloadURL(snapshot.ref);
    
    const user= await User.findOne({id:userId});
    const newPost=new Post({
        userId:userId,
        name:user.name,
        description:desc,
        userPath:user.picPath,
        postPath:postURL,
        likes:new Map(),
    });
    await newPost.save();
    const post= await Post.find().sort({createAt:-1});
    res.status(201).json(post);
}catch(err){
        res.status(404).json({ message: err.message });
    }
});


app.get("/posts",async(req,res)=>{
    try{let token = req.header("Authorization");
    if (!token) {
      return res.status(403).send("Access Denied");
    }
    const verify=await TokenModel.find({"token":token});
    if(!verify)return res.status(403).send("Access Denied");
    const post=await Post.find().sort({createAt:-1});
    res.status(200).json(post);}
    catch(err){
        res.status(404).json({ message: err.message });
    }
});


app.get("/posts/:uid", async (req,res)=>{
    try{
    let token = req.header("Authorization");
    if (!token) {
      return res.status(403).send("Access Denied");
    }
    const verify=await TokenModel.find({"token":token});
    if(!verify)return res.status(403).send("Access Denied");
    const userId=req.params.uid;
    const post= await Post.find({userId:userId});
    res.status(200).json(post);}
    catch(err){
        res.status(404).json({ message: err.message });
    }
});

app.patch("/likes/:id",async(req,res)=>{
    try{
        let token = req.header("Authorization");
        if (!token) {
          return res.status(403).send("Access Denied");
        }
        const verify= await TokenModel.find({"token":token});
        if(!verify)return res.status(403).send("Access Denied");
        const userMail=req.body.mail;
        if(userMail!==verify[0].uid)return res.status(403).send("Access Denied");
    const id=req.params.id;
    const userId=req.body.userId;
    const post=await Post.findById(id);
    const isLiked=post.likes.get(userId);
    if(isLiked){
        post.likes.delete(userId);
    }
    else{
        post.likes.set(userId,true);
    }
    const updatedPost= await Post.findByIdAndUpdate(
    id,{likes:post.likes},{new:true}
    );
    res.status(200).json(updatedPost);}
    catch(err){
        res.status(404).json({ message: err.message });
    }
});
app.patch("/streak/:id",async(req,res)=>{
    try{
        let token = req.header("Authorization");
        if (!token) {
          return res.status(403).send("Access Denied");
        }
        const verify= await TokenModel.find({"token":token});
        if(!verify)return res.status(403).send("Access Denied");
        const userMail=req.body.mail;
        if(userMail!==verify[0].uid)return res.status(403).send("Access Denied");
    const id=req.params.id;
    const updatedUser= await User.findOneAndUpdate(
    {id:id},{streak:new Date()},{new:true});
    res.status(200).json(updatedUser);}
    catch(err){
        res.status(404).json({ message: err.message });
    }
});
app.post("/message",(req,res)=>{
    const myAI={role:"system",content:"Answer all the next question like a  Guru because you are a guru for helping men with urges to masturbate help me divert their mind from it"};
    const user=req.body.message;
    const messages=[myAI,...user];
    const response=openai.createChatCompletion({
        model:"gpt-3.5-turbo",
        messages:messages,
        temperature:0.8,
        max_tokens:3024
    });
    response.then((data)=>{
        res.json({message:data.data.choices[0].message});
    });
});
app.get("/leaderboard", async (req,res)=>{
    try{
        let token = req.header("Authorization");
        if (!token) {
          return res.status(403).send("Access Denied");
        }
        const verify=TokenModel.find({"token":token});
        if(!verify)return res.status(403).send("Access Denied");
    const users=await User.find().sort({streak:1});   
    res.status(200).send(users);}
    catch(err){
        res.status(404).json({ message: err.message });
    }
});



app.listen(process.env.PORT,()=>{
    console.log("Server is Running!");

});

