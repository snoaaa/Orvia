// angular import
import { Component, OnInit, viewChild } from '@angular/core';

// project import

// third party
import { NgApexchartsModule, ChartComponent, ApexOptions } from 'ng-apexcharts';

@Component({
  selector: 'app-monthly-bar-chart',
  imports: [NgApexchartsModule],
  templateUrl: './monthly-bar-chart.component.html',
  styleUrl: './monthly-bar-chart.component.scss'
})
export class MonthlyBarChartComponent implements OnInit {
  // public props
  chart = viewChild.required<ChartComponent>('chart');
  chartOptions: Partial<ApexOptions>;
  constructor() {
    this.chartOptions = {
      chart: {
        height: 450,
        type: 'area',
        fontFamily: "'Glacial Indifference', sans-serif",
        toolbar: {
          show: false
        },
        background: 'transparent'
      },
      dataLabels: {
        enabled: false
      },
      colors: ['#000000', '#8c8c8c'],
      series: [
        {
          name: 'Successful logins',
          data: [42, 51, 38, 64, 58, 21, 12]
        },
        {
          name: 'Failed logins',
          data: [3, 5, 2, 7, 4, 1, 0]
        }
      ],
      stroke: {
        curve: 'smooth',
        width: 2
      },
      xaxis: {
        categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        labels: {
          style: {
            colors: [
              '#8c8c8c',
              '#8c8c8c',
              '#8c8c8c',
              '#8c8c8c',
              '#8c8c8c',
              '#8c8c8c',
              '#8c8c8c',
              '#8c8c8c',
              '#8c8c8c',
              '#8c8c8c',
              '#8c8c8c',
              '#8c8c8c'
            ]
          }
        },
        axisBorder: {
          show: true,
          color: '#f0f0f0'
        },
        tickAmount: 7
      },
      yaxis: {
        labels: {
          style: {
            colors: ['#8c8c8c']
          }
        }
      },
      grid: {
        strokeDashArray: 0,
        borderColor: '#f5f5f5'
      },
      theme: {
        mode: 'light'
      }
    };
  }

  // life cycle hook
  ngOnInit() {
    document.querySelector('.chart-income.week')?.classList.add('active');
  }

  // public method
  toggleActive(value: string) {
    this.chartOptions.series = [
      {
        name: 'Successful logins',
        data:
          value === 'month'
            ? [820, 910, 1040, 980, 1120, 760, 690, 1240, 1310, 1180, 1090, 640]
            : [42, 51, 38, 64, 58, 21, 12]
      },
      {
        name: 'Failed logins',
        data: value === 'month' ? [41, 38, 57, 44, 61, 33, 29, 52, 74, 66, 48, 31] : [3, 5, 2, 7, 4, 1, 0]
      }
    ];
    const xaxis = { ...this.chartOptions.xaxis };
    xaxis.categories =
      value === 'month'
        ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    xaxis.tickAmount = value === 'month' ? 11 : 7;
    this.chartOptions = { ...this.chartOptions, xaxis };
    if (value === 'month') {
      document.querySelector('.chart-income.month')?.classList.add('active');
      document.querySelector('.chart-income.week')?.classList.remove('active');
    } else {
      document.querySelector('.chart-income.week')?.classList.add('active');
      document.querySelector('.chart-income.month')?.classList.remove('active');
    }
  }
}
