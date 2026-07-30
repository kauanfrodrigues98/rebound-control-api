import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CurrentControlUser } from './current-control-user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentControlUser => {
    const request = context.switchToHttp().getRequest<{ user: CurrentControlUser }>();
    return request.user;
  },
);
