import { BadRequestException, HttpException, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService, JwtSignOptions, JwtVerifyOptions } from "@nestjs/jwt";
import { UserRepository } from "src/DB/models/User/user.repository";
export const tokenTypes = {
    access: 'access',
    refresh: 'refresh'
}
@Injectable()
export class TokenService {
    constructor(private readonly jwtService: JwtService,
        private readonly userRepository: UserRepository
    ) { }

    sign(payload: object, options: JwtSignOptions) {
        return this.jwtService.sign(
            payload,
            options
        )
    }
    verify(token: string, options?: JwtVerifyOptions) {
        return this.jwtService.verify(token, options)
    }
    async decodeToken(authorization: string) {
        try {
            const token = authorization
            if (!token) {
                throw new BadRequestException(`In-valid token`);
            }
            

            const decoded = this.verify( token , { secret: process.env.JWT_SECRET });
            if (!decoded?.id) {
                throw new BadRequestException(`In-valid token payload`);
            }
            const user = await this.userRepository.findOne({ _id: decoded?.["id"] })
            if (!user) {
                throw new NotFoundException("User not found");
            }
            if (user.changeCredentialsTime?.getTime() >= (decoded?.iat * 1000)) {
                throw new UnauthorizedException("User changed his credentials, please login again");
            }
            return user
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            if (error?.name === "TokenExpiredError" || error?.message?.includes("jwt expired")) {
                throw new UnauthorizedException("jwt expired");
            }
            if (error?.name === "JsonWebTokenError") {
                throw new UnauthorizedException("Invalid token");
            }
            throw new InternalServerErrorException(error)
        }
    }
}