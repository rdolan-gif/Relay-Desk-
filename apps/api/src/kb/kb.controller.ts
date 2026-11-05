import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { Auth, RequireAccess } from '../auth/decorators';
import type { AuthContext } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { KbService } from './kb.service';

const folderSchema = z.object({
  title: z.string().trim().min(1).max(200),
  parentId: z.string().uuid().nullable().default(null),
  position: z.number().int().min(0).max(100_000).optional(),
});
const articleSchema = z.object({
  folderId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  bodyHtml: z.string().max(500_000).default(''),
  tags: z.array(z.string().max(50)).max(30).default([]),
  sourceActivityId: z.string().uuid().nullable().optional(),
});
const listSchema = z.object({
  folderId: z.string().uuid().optional(),
  tag: z.string().max(50).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** Knowledge base (spec 15): module access plus folder rights. */
@ApiTags('knowledge base')
@Controller('kb')
export class KbController {
  constructor(@Inject(KbService) private readonly kb: KbService) {}

  @RequireAccess('knowledge_base', 'read')
  @Get('folders')
  folders(@Auth() auth: AuthContext) {
    return this.kb.folders(auth);
  }

  @RequireAccess('knowledge_base', 'create')
  @Post('folders')
  createFolder(@Auth() auth: AuthContext, @Body(new ZodPipe(folderSchema)) b: z.infer<typeof folderSchema>) {
    return this.kb.createFolder(auth, b);
  }

  @RequireAccess('knowledge_base', 'update')
  @Put('folders/:id')
  updateFolder(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(folderSchema)) b: z.infer<typeof folderSchema>,
  ) {
    return this.kb.updateFolder(auth, id, b);
  }

  @RequireAccess('knowledge_base', 'delete')
  @Delete('folders/:id')
  @HttpCode(204)
  async deleteFolder(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.kb.deleteFolder(auth, id);
  }

  @RequireAccess('knowledge_base', 'read')
  @Get('tags')
  tags(@Auth() auth: AuthContext) {
    return this.kb.tags(auth);
  }

  @RequireAccess('knowledge_base', 'read')
  @Get('articles')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.kb.list(auth, q);
  }

  @RequireAccess('knowledge_base', 'create')
  @Get('drafts/from-activity/:id')
  draft(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.kb.draftFromActivity(auth, id);
  }

  @RequireAccess('knowledge_base', 'read')
  @Get('articles/:id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.kb.get(auth, id);
  }

  @RequireAccess('knowledge_base', 'create')
  @Post('articles')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(articleSchema)) b: z.infer<typeof articleSchema>) {
    return this.kb.create(auth, b);
  }

  @RequireAccess('knowledge_base', 'update')
  @Put('articles/:id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(articleSchema)) b: z.infer<typeof articleSchema>,
  ) {
    return this.kb.update(auth, id, b);
  }

  @RequireAccess('knowledge_base', 'delete')
  @Delete('articles/:id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.kb.remove(auth, id);
  }

  @RequireAccess('knowledge_base', 'read')
  @Get('articles/:id/versions')
  versions(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.kb.versions(auth, id);
  }

  @RequireAccess('knowledge_base', 'update')
  @Post('articles/:id/versions/:version/restore')
  @HttpCode(200)
  restore(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.kb.restore(auth, id, version);
  }

  @RequireAccess('knowledge_base', 'update')
  @Post('articles/:id/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  addFile(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    return this.kb.addFile(auth, id, file);
  }

  /** Images display inline; anything else downloads. */
  @RequireAccess('knowledge_base', 'read')
  @Get('files/:id')
  async file(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.kb.file(auth, id);
    const image = /^image\/(png|jpe?g|gif|webp)$/.test(f.mime);
    res.setHeader('Content-Type', image ? f.mime : 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${image ? 'inline' : 'attachment'}; filename="${f.filename.replace(/[^\w.\- ]/g, '_')}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(f.data);
  }

  @RequireAccess('knowledge_base', 'update')
  @Delete('files/:id')
  @HttpCode(204)
  async removeFile(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.kb.removeFile(auth, id);
  }
}
