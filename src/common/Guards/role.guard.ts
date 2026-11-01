import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../Decorator/role.decorator';
import { Public } from '../Decorator/public.decorator';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const publicValue = this.reflector.getAllAndMerge(Public, [
      context.getClass(),
      context.getHandler(),
    ]);
    if (publicValue[0] == 'public') {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<string[]>(Role, [
      context.getHandler(),
      context.getClass(),
    ]);
    // if no roles specified, allow (or change to deny depending on your policy)
    if (!roles || !roles.length) return true;

    const request = this.getRequest(context);

    const userRole = request?.user?.role;

    if (!userRole || !roles.includes(userRole)) {
      // The user is authenticated but does not have this role.  Return
      // 403 rather than 401 so clients do not treat it as a bad session.
      throw new ForbiddenException(
        'You are not authorized to access this resource',
      );
    }
    return true;
  }

  private getRequest(context: ExecutionContext) {
    switch (context['contextType']) {
      case 'http':
        return context.switchToHttp().getRequest();
      case 'ws':
        return context.switchToWs().getClient();
    }
  }
}
