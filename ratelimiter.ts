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

    validateIP (ip: string | undefined) { //not done
        if ( ip === undefined) {
            // console.log("an undefined request was detected. This might indicate a misconfiguration");
        
            return isIP( String(ip) )
        }

        if ( !isIP( String(ip) ) ) {
            
            return isIP( String(ip))
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

    async consume (key: string | undefined) { //key here is the id from req.id

        const clientIP = this.validateIP(key)
        const keyExists = await client.EXISTS( String(key) )
        let Limiter = JSON.parse( String( await client.GET( String(key) ) ) )

        return new Promise( async (resolve, reject) => {

            if (Number(clientIP) === 0) {

                reject("an undefined/invalid request was detected. This might indicate a misconfiguration")
            }

            if (keyExists === 1) {

                    if ( Limiter.pointCount <= Limiter.pointToConsume ) {

                        this.set(
                            String(key) ,
                            {
                                PointToConsume: Number(Limiter.pointToConsume),
                                PointCount: Number(Limiter.pointCount) + 1,
                                ExpireAt: new Date( Date.now() + this.blockDuration )
                            }
                        )
                        
                        Limiter = JSON.parse( String( await client.GET( String(key) ) ) )

                        if (Limiter.pointCount === Limiter.pointToConsume) {

                                //set a blockDuration 
                                this.set(
                                String(key) ,
                                {
                                    PointToConsume: Number(Limiter.pointToConsume),
                                    PointCount: Number(Limiter.pointCount) + 1,
                                    ExpireAt: new Date( Date.now() + this.blockDuration ),
                                    BlockDuration: new Date( Date.now() + this.blockDuration )
                                }
                            )

                            Limiter = JSON.parse( String( await client.GET( String(key) ) ) )   
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

                            this.delete( String(key) )
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
                    String(key) ,
                    {
                        PointToConsume: this.points,
                        PointCount: 1,
                        ExpireAt: new Date( Date.now() + this.blockDuration )
                    }
                )
                
                Limiter = JSON.parse( String( await client.GET( String(key) ) ) )

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