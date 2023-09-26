import express, {NextFunction, Request, Response} from "express"
import { connRedis, RateLimiter } from "./ratelimiter";

const app =express()

connRedis()

const ratelimiter = new RateLimiter({
    points: 2,
    blockDuration: 40 * 1000 // 5 seconds
})



app.use( (req: Request, res: Response, next: NextFunction) => {
    
    ratelimiter.consume(undefined)
    .then( e => {
        // console.log("consume works: ", e);
        next()
    })
    .catch ( e => {
        // console.log("consume failed: ", e);
        res.send(e)
    })
})

app.get("/", (req: Request, res: Response) => {
    res.send("Hello from testing")
})

app.listen(8880, ( )=> {

    console.log("connected to server successfully");
})