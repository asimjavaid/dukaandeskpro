import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { AutoBackupService } from './auto-backup.service';
import { ResetDataService } from './reset-data.service';
import { PgBackupService } from './pg-backup.service';
import { ResetDataController } from './reset-data.controller';

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [BackupController, ResetDataController],
  providers: [BackupService, AutoBackupService, ResetDataService, PgBackupService],
  exports: [BackupService, AutoBackupService, PgBackupService],
})
export class BackupModule {}
