// angular import
import { Component, viewChild } from '@angular/core';

// project import

// third party
import { NgApexchartsModule, ChartComponent, ApexOptions } from 'ng-apexcharts';
import { CardComponent } from 'src/app/admin/theme/shared/components/card/card.component';

@Component({
  selector: 'app-income-overview-chart',
  imports: [CardComponent, NgApexchartsModule],
  templateUrl: './income-overview-chart.component.html',
  styleUrl: './income-overview-chart.component.scss'
})
export class IncomeOverviewChartComponent {
  // public props
  chart = viewChild.required<ChartComponent>('chart');
  chartOptions: Partial<ApexOptions>;
  constructor() {
    this.chartOptions = {
      chart: {
        type: 'bar',
        height: 365,
        fontFamily: "'Glacial Indifference', sans-serif",
        toolbar: {
          show: false
        },
        background: 'transparent'
      },
      plotOptions: {
        bar: {
          columnWidth: '45%',
          borderRadius: 4
        }
      },
      dataLabels: {
        enabled: false
      },
      series: [
        {
          data: [512, 398, 341, 226, 154, 118, 93]
        }
      ],
      stroke: {
        curve: 'smooth',
        width: 2
      },
      xaxis: {
        categories: ['Math', 'Physics', 'CS', 'Biology', 'History', 'Langues', 'Admin'],
        axisBorder: {
          show: false
        },
        axisTicks: {
          show: false
        },
        labels: {
          style: {
            colors: ['#8c8c8c', '#8c8c8c', '#8c8c8c', '#8c8c8c', '#8c8c8c', '#8c8c8c', '#8c8c8c']
          }
        }
      },
      yaxis: {
        show: false
      },
      colors: ['#8c8c8c'],
      grid: {
        show: false
      },
      tooltip: {
        theme: 'light'
      }
    };
  }
}
