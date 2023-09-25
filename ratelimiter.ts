import {isIP} from "node:net"
import {promisify} from "util"
// import Redis from "ioredis"
// const redis = new Redis()

import { createClient } from 'redis';

const client = createClient()

export function connRedis() {

    client
    .on('error', err => console.log('Redis Client Error', err))
    .connect();

    console.log("connected to redis");
    return
}


// export async function result (key: string) {
//     try {
        
//         await client.hSet(key, {name: "Amidat", age: 29+1})

//         const check =(await client.hGetAll(key)).name

//         console.log("why: ", check);

//     } catch (err) {
//         console.log(err);
//     }
// }


export class RateLimiter {
    constructor(
        opts: {
            points: number, //points to consume
            // resetAt: number, //duration before deleting points from storage if not updated
            blockDuration: number //duration to wait before next request (expressed in milliseconds)
        }
    ) {

        this.points = opts.points
        // this.expireAt = opts.resetAt
        this.blockDuration = opts.blockDuration
    }

    points: number
    // expireAt: number
    blockDuration: number

    keyGenerator (ip: string | undefined) { //use the ip address as the rate limiter
        if ( ip === undefined) {
            throw new Error("an undefined request was detected. This might indicate a misconfiguration")
        }

        if ( !isIP(ip) ) {
            throw new Error(`An invalid 'request.ip' (${ip}) was detected.`)
        }

        return ip
    }

    async set (
        key: string, 
        values: {
            PointToConsume: number,
            PointCount: number,
            ExpireAt: Date,
            BlockDuration?: Date //in ms
        }
    ) {

        const obj = JSON.stringify({
            pointToConsume: values.PointToConsume, 
            pointCount: values.PointCount, 
            expireAt: (values.ExpireAt).toString(), 
            blockDuration: ( values.BlockDuration ? ( values.BlockDuration ).toString() : 0)
        })

        await client.setEx(
            key,
            (this.blockDuration) / 1000,
            obj
        )
    }

    async delete (key: string) {

       await client.DEL(key)
    }

    rateLimiterRes (
            result: {
                consumed_point: string, 
                MaxPoint: number,
                resetTime: string, 
                RemainingPoints: number,
                Message: string
            }
        ) {
        return {
            consumedPoint: result.consumed_point,
            maxPoint: result.MaxPoint,
            remainingPoints: result.RemainingPoints,
            msBeforeNext: result.resetTime,
            message: result.Message
        }
    }

    async consume (key: string) { //key here is the id from req.id

        const keyExists = await client.EXISTS(key)
        let Limiter = JSON.parse( String( await client.GET(key) ) )

        return new Promise( async (resolve, reject) => {
            if (keyExists === 1) {
                
                const currentTime = Date.now()

                    if ( Limiter.pointCount <= Limiter.pointToConsume ) {

                        this.set(
                            key,
                            {
                                PointToConsume: Number(Limiter.pointToConsume),
                                PointCount: Number(Limiter.pointCount) + 1,
                                ExpireAt: new Date( Date.now() + this.blockDuration )
                            }
                        )
                        
                        Limiter = JSON.parse( String( await client.GET(key) ) )

                        if (Limiter.pointCount === Limiter.pointToConsume) {

                                //set a blockDuration 
                                this.set(
                                key,
                                {
                                    PointToConsume: Number(Limiter.pointToConsume),
                                    PointCount: Number(Limiter.pointCount) + 1,
                                    ExpireAt: new Date( Date.now() + this.blockDuration ),
                                    BlockDuration: new Date( Date.now() + this.blockDuration )
                                }
                            )

                            Limiter = JSON.parse( String( await client.GET(key) ) )
                            
                        }

                        resolve(
                            this.rateLimiterRes({
        
                                consumed_point: Limiter.pointCount,
                                resetTime: "", //time user have to wait before making next call
                                RemainingPoints: this.points - Limiter.pointCount,
                                Message: "Success",
                                MaxPoint: this.points
                            })
                        )
                    } 
                    else {

                        //if block duration elapse, delete key 
                        if ( Limiter.BlockDuration > new Date() ) {

                            this.delete(key)
                        }

                        reject(
                            this.rateLimiterRes({
                                consumed_point: Limiter.pointCount,
                                resetTime: Limiter.blockDuration, 
                                RemainingPoints: 0,
                                Message: "You have exceeded the limit",
                                MaxPoint: this.points
                            })
                        )
                    }
                
            } else { //create new key

                this.set(
                    key,
                    {
                        PointToConsume: this.points,
                        PointCount: 1,
                        ExpireAt: new Date( Date.now() + this.blockDuration )
                    }
                )
                
                Limiter = JSON.parse( String( await client.GET(key) ) )

                resolve(
                    this.rateLimiterRes({

                        consumed_point: Limiter.pointCount,
                        resetTime: "", 
                        RemainingPoints: this.points - Limiter.pointCount,
                        Message: "Success",
                        MaxPoint: this.points
                        
                    })
                )
            }
        })
    }
}